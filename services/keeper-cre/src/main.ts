// Chainlink CRE keeper workflow (PRD 10.1, spike S4).
//
// On every cron tick it reads each mandate account's state, monitors and oracle-guard verdict straight from Monad,
// decides exactly what services/keeper-relayer decides (same rule, same thresholds), and writes a signed report to
// CreKeeperReceiver, which forwards it to BondVault.
//
// Before it flags anything it also asks Perpl's own public API for the mark price of every market the account holds,
// with the CRE nodes agreeing on the answer by median. A breach is flagged only when three independent views agree:
// Perpl's on-chain mark, the Chainlink feed (OracleGuard) and Perpl's off-chain API. That is the orchestration job:
// joining a chain, a price oracle and an external API into one decision no single source can force.
//
// BondVault recomputes the breach itself, so the workflow cannot cause a false flag: an incorrect report simply
// fails on-chain. That is why this is safe to run as an unattended automation.
//
//   npx cre workflow simulate      (see README for the config)
import {
  ConsensusAggregationByFields,
  CronCapability,
  EVMClient,
  HTTPClient,
  median,
  type HTTPSendRequester,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  bytesToHex,
  encodeCallMsg,
  handler,
  getNetwork,
  prepareReportRequest,
  type CronPayload,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeFunctionResult, encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import {
  bondVaultAbi,
  drawdownBps,
  isDrawdownBreached,
  mandateAccountAbi,
  mandateRegistryAbi,
  oracleGuardAbi,
  perplAdapterAbi,
} from "@mandate/common";

export type Config = {
  /** Chain selector name from `cre workflow supported-chains`, e.g. "monad-testnet". */
  chainSelectorName: string;
  schedule: string;
  /** Mandate contracts, from contracts/deployments/<chainId>.json. */
  mandateRegistry: Address;
  perplAdapter: Address;
  oracleGuard: Address;
  bondVault: Address;
  /** The CreKeeperReceiver deployed for this workflow. */
  receiver: Address;
  accounts: Address[];
  gasLimit: string;
  /** Perpl's public REST API, e.g. "https://testnet.perpl.xyz/api" (GET /v1/pub/context, no auth). */
  perplApi: string;
  /** How far Perpl's API mark may sit from the on-chain mark before the workflow refuses to flag, in bps. */
  maxVenueDeviationBps: number;
};

/** One market's mark as Perpl's API reports it, in the market's price units (the same scale as the on-chain mark). */
type VenueMark = { mark: number; block: number };

const ACTION_FLAG = 0;
const ACTION_SLASH = 1;
/** Mirrors RuleKind.MaxDrawdown in contracts/src/rules/RuleTypes.sol. */
const MAX_DRAWDOWN = 5;

function read<const abi extends readonly unknown[], T>(
  evm: EVMClient,
  runtime: Runtime<Config>,
  address: Address,
  abi: abi,
  functionName: string,
  args: readonly unknown[],
): T {
  const result = evm
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: address,
        data: encodeFunctionData({ abi, functionName, args } as never),
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result();
  return decodeFunctionResult({ abi, functionName, data: bytesToHex(result.data) } as never) as T;
}

type OpenMarket = { marketId: bigint; size: bigint; mark: bigint };

/** The same check the relayer makes: is a market rule broken, and does the oracle guard trust the marks? */
function assess(
  evm: EVMClient,
  runtime: Runtime<Config>,
  cfg: Config,
  account: Address,
): { ruleIndex: number; drawdownBps: number; limitBps: number; trusted: boolean; markets: OpenMarket[] } | undefined {
  const [exists, active, rules] = read<typeof mandateRegistryAbi, [boolean, boolean, { kind: number; p1: bigint }[]]>(
    evm,
    runtime,
    cfg.mandateRegistry,
    mandateRegistryAbi,
    "rulesOf",
    [account],
  );
  if (!exists || !active) return undefined;
  if (read<typeof mandateAccountAbi, boolean>(evm, runtime, account, mandateAccountAbi, "closeOnly", [])) return undefined;

  const state = read<typeof perplAdapterAbi, { equity: bigint; markets: readonly OpenMarket[] }>(
    evm,
    runtime,
    cfg.perplAdapter,
    perplAdapterAbi,
    "accountState",
    [account],
  );
  const equity = state.equity > 0n ? state.equity : 0n;

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    if (rule.kind !== MAX_DRAWDOWN) continue;
    const monitor = read<typeof mandateAccountAbi, { w0: bigint }>(evm, runtime, account, mandateAccountAbi, "monitor", [BigInt(i)]);
    const peak = monitor.w0;
    if (peak === 0n) continue;
    // Same shared math the relayer uses, so the two keepers can never disagree about what a breach is.
    if (!isDrawdownBreached(peak, equity, rule.p1)) continue;
    const trusted = read<typeof oracleGuardAbi, boolean>(evm, runtime, cfg.oracleGuard, oracleGuardAbi, "accountMarksTrusted", [account]);
    return {
      ruleIndex: i,
      drawdownBps: drawdownBps(peak, equity),
      limitBps: Number(rule.p1),
      trusted,
      markets: state.markets.filter((m) => m.size !== 0n),
    };
  }
  return undefined;
}

/** Runs on each CRE node: fetch Perpl's public market context and pull one market's mark and the block it is from. */
const fetchVenueMark = (sendRequester: HTTPSendRequester, apiUrl: string, perpId: number): VenueMark => {
  const res = sendRequester.sendRequest({ url: `${apiUrl}/v1/pub/context`, method: "GET" }).result();
  if (res.statusCode !== 200) throw new Error(`Perpl API returned ${res.statusCode}`);
  const ctx = JSON.parse(new TextDecoder().decode(res.body)) as {
    markets: { perpetual_id: number; state?: { mrk?: number; at?: { b?: number } } }[];
  };
  const market = ctx.markets.find((m) => m.perpetual_id === perpId);
  const mark = market?.state?.mrk;
  const block = market?.state?.at?.b;
  if (!mark || !block) throw new Error(`Perpl API has no mark for market ${perpId}`);
  return { mark, block };
};

/**
 * Does Perpl's own API agree with the on-chain mark for every market the account holds? The nodes each fetch the API
 * and agree by median, so one bad response can't decide it.
 */
function venueAgrees(
  http: HTTPClient,
  runtime: Runtime<Config>,
  cfg: Config,
  markets: readonly OpenMarket[],
): { ok: boolean; detail: string } {
  const readMark = http.sendRequest(
    runtime,
    fetchVenueMark,
    ConsensusAggregationByFields<VenueMark>({ mark: median, block: median }),
  );
  for (const m of markets) {
    const venue = readMark(cfg.perplApi, Number(m.marketId)).result();
    const chain = Number(m.mark);
    const deviationBps = chain > 0 ? Math.round((Math.abs(venue.mark - chain) * 10_000) / chain) : Infinity;
    if (deviationBps > cfg.maxVenueDeviationBps) {
      return {
        ok: false,
        detail: `market ${m.marketId}: Perpl API mark ${venue.mark} (block ${venue.block}) is ${deviationBps} bps from the on-chain mark ${chain}`,
      };
    }
  }
  return { ok: true, detail: `Perpl API agrees on ${markets.length} market(s)` };
}

function submit(evm: EVMClient, runtime: Runtime<Config>, cfg: Config, action: number, account: Address, value: bigint) {
  const payload = encodeFunctionData({
    abi: [{ type: "function", name: "report", inputs: [{ type: "uint8" }, { type: "address" }, { type: "uint256" }], outputs: [] }],
    functionName: "report",
    args: [action, account, value],
  });
  // The receiver decodes abi.encode(uint8, address, uint256); strip the 4-byte selector viem adds.
  const report = runtime.report(prepareReportRequest(`0x${payload.slice(10)}` as Hex)).result();
  return evm
    // The SDK takes the receiver as a hex address string; base64 fails at runtime ("Invalid hex string").
    .writeReport(runtime, { receiver: cfg.receiver, report, gasConfig: { gasLimit: cfg.gasLimit } })
    .result();
}

const onTick = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName });
  if (!network) throw new Error(`Unknown chain selector ${cfg.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);
  const http = new HTTPClient();

  let actions = 0;
  for (const account of cfg.accounts) {
    const breach = assess(evm, runtime, cfg, account);
    if (breach) {
      if (!breach.trusted) {
        runtime.log(`${account}: drawdown ${breach.drawdownBps} bps over ${breach.limitBps}, but the marks are not trusted; waiting.`);
        continue;
      }
      const venue = venueAgrees(http, runtime, cfg, breach.markets);
      if (!venue.ok) {
        runtime.log(`${account}: drawdown ${breach.drawdownBps} bps over ${breach.limitBps}, but ${venue.detail}; waiting.`);
        continue;
      }
      runtime.log(`${account}: flagging drawdown ${breach.drawdownBps} bps over ${breach.limitBps} (${venue.detail}).`);
      submit(evm, runtime, cfg, ACTION_FLAG, account, BigInt(breach.ruleIndex));
      actions++;
      continue;
    }
    // Nothing to flag: pay out any breach whose dispute window has passed. BondVault rejects it if it has not.
    const open = read<typeof bondVaultAbi, bigint>(evm, runtime, cfg.bondVault, bondVaultAbi, "openBreachOf", [account]);
    if (open > 0n) {
      runtime.log(`${account}: attempting to slash breach ${open - 1n}.`);
      submit(evm, runtime, cfg, ACTION_SLASH, account, open - 1n);
      actions++;
    }
  }
  return `checked ${cfg.accounts.length} account(s) at ${payload.scheduledExecutionTime?.seconds ?? "?"}, ${actions} action(s)`;
};

const initWorkflow = (config: Config) => [handler(new CronCapability().trigger({ schedule: config.schedule }), onTick)];

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

await main();
