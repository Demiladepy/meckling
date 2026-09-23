// Chainlink CRE keeper workflow (PRD 10.1, spike S4).
//
// On every cron tick it reads each mandate account's state, monitors and oracle-guard verdict straight from Monad,
// decides exactly what services/keeper-relayer decides (same rule, same thresholds), and writes a signed report to
// CreKeeperReceiver, which forwards it to BondVault.
//
// BondVault recomputes the breach itself, so the workflow cannot cause a false flag: an incorrect report simply
// fails on-chain. That is why this is safe to run as an unattended automation.
//
//   npx cre workflow simulate      (see README for the config)
import {
  CronCapability,
  EVMClient,
  LAST_FINALIZED_BLOCK_NUMBER,
  Runner,
  bytesToHex,
  encodeCallMsg,
  handler,
  hexToBase64,
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
};

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

/** The same check the relayer makes: is a market rule broken, and does the oracle guard trust the marks? */
export function assess(
  evm: EVMClient,
  runtime: Runtime<Config>,
  cfg: Config,
  account: Address,
): { ruleIndex: number; drawdownBps: number; limitBps: number; trusted: boolean } | undefined {
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

  const state = read<typeof perplAdapterAbi, { equity: bigint }>(evm, runtime, cfg.perplAdapter, perplAdapterAbi, "accountState", [account]);
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
    return { ruleIndex: i, drawdownBps: drawdownBps(peak, equity), limitBps: Number(rule.p1), trusted };
  }
  return undefined;
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
    .writeReport(runtime, { receiver: hexToBase64(cfg.receiver), report, gasConfig: { gasLimit: cfg.gasLimit } })
    .result();
}

const onTick = (runtime: Runtime<Config>, payload: CronPayload): string => {
  const cfg = runtime.config;
  const network = getNetwork({ chainFamily: "evm", chainSelectorName: cfg.chainSelectorName });
  if (!network) throw new Error(`Unknown chain selector ${cfg.chainSelectorName}`);
  const evm = new EVMClient(network.chainSelector.selector);

  let actions = 0;
  for (const account of cfg.accounts) {
    const breach = assess(evm, runtime, cfg, account);
    if (breach) {
      if (!breach.trusted) {
        runtime.log(`${account}: drawdown ${breach.drawdownBps} bps over ${breach.limitBps}, but the marks are not trusted; waiting.`);
        continue;
      }
      runtime.log(`${account}: flagging drawdown ${breach.drawdownBps} bps over ${breach.limitBps}.`);
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
