// viem helpers shared by the agent, keeper and app: read account state, simulate and send `execute` with a tight
// gas limit (Monad charges the gas limit, not gas used), and measure block time at startup (PRD rule 6).
import {
  decodeErrorResult,
  encodeErrorResult,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mandateAccountAbi, mandateRegistryAbi, perplAdapterAbi, perplErrorsAbi } from "./abis.ts";
import type { Call } from "./perpl.ts";
import type { Rule } from "./rules.ts";

export interface MarketState {
  marketId: number;
  size: bigint;
  mark: bigint;
  markValid: boolean;
  notional: bigint;
  upnl: bigint;
}

export interface AccountState {
  equity: bigint;
  totalNotional: bigint;
  marginUsed: bigint;
  markets: MarketState[];
}

export async function readAccountState(client: PublicClient, adapter: Address, account: Address): Promise<AccountState> {
  const s = await client.readContract({ address: adapter, abi: perplAdapterAbi, functionName: "accountState", args: [account] });
  return {
    equity: s.equity,
    totalNotional: s.totalNotional,
    marginUsed: s.marginUsed,
    markets: s.markets.map((m) => ({ ...m, marketId: Number(m.marketId) })),
  };
}

export async function readMark(client: PublicClient, adapter: Address, account: Address, perpId: number) {
  const m = await client.readContract({
    address: adapter,
    abi: perplAdapterAbi,
    functionName: "marketState",
    args: [account, BigInt(perpId)],
  });
  return { mark: m.mark, markValid: m.markValid };
}

export async function readRules(client: PublicClient, registry: Address, account: Address) {
  const [exists, active, rules] = await client.readContract({
    address: registry,
    abi: mandateRegistryAbi,
    functionName: "rulesOf",
    args: [account],
  });
  return { exists, active, rules: rules.map((r) => ({ kind: r.kind, p1: r.p1, p2: r.p2, p3: r.p3 }) as Rule) };
}

export async function readMonitors(client: PublicClient, account: Address, count: number) {
  return Promise.all(
    Array.from({ length: count }, (_, i) =>
      client.readContract({ address: account, abi: mandateAccountAbi, functionName: "monitor", args: [BigInt(i)] }),
    ),
  );
}

type ErrLike = { name?: string; cause?: unknown; data?: unknown; raw?: Hex };

/** Walks an error's cause chain. Duck-typed by name, so it works whichever viem copy created the error. */
function walk(err: unknown, pick: (e: ErrLike) => boolean): ErrLike | undefined {
  let e = err as ErrLike | undefined;
  for (let depth = 0; e && depth < 20; depth++) {
    if (pick(e)) return e;
    e = e.cause as ErrLike | undefined;
  }
  return undefined;
}

/** Pulls revert data out of a viem error, for decodeViolation. */
export function revertData(err: unknown): Hex | undefined {
  const reverted = walk(err, (e) => e.name === "ContractFunctionRevertedError") as
    | (ErrLike & { data?: { abiItem?: unknown; errorName: string; args?: readonly unknown[] } })
    | undefined;
  if (reverted) {
    if (reverted.raw) return reverted.raw;
    // viem decodes errors it finds in the ABI and drops the raw bytes; re-encode them.
    if (reverted.data?.abiItem) {
      return encodeErrorResult({ abi: [reverted.data.abiItem], errorName: reverted.data.errorName, args: reverted.data.args ?? [] } as never);
    }
  }
  const withData = walk(err, (e) => typeof e.data === "string" && (e.data as string).startsWith("0x"));
  return withData?.data as Hex | undefined;
}

export type ExecuteResult =
  | { status: "filled"; txHash: Hex; blockNumber: bigint; gasUsed: bigint }
  | { status: "reverted"; revertData?: Hex; blockNumber: bigint; txHash?: Hex; error: string };

/**
 * Simulates `execute` at the latest block; if it would revert, returns the revert data without sending (no gas
 * spent). Otherwise sends with gas = estimate * (1 + headroom) so the charged limit stays tight.
 */
export async function executeTight(
  pub: PublicClient,
  wallet: WalletClient,
  signer: Account,
  mandateAccount: Address,
  calls: Call[],
  headroomBps = 1500,
): Promise<ExecuteResult> {
  const args = [calls.map((c) => ({ target: c.target, data: c.data }))] as const;
  const blockNumber = await pub.getBlockNumber();
  try {
    await pub.simulateContract({ address: mandateAccount, abi: mandateAccountAbi, functionName: "execute", args, account: signer });
  } catch (err) {
    return { status: "reverted", revertData: revertData(err), blockNumber, error: shortError(err) };
  }
  const estimate = await pub.estimateContractGas({ address: mandateAccount, abi: mandateAccountAbi, functionName: "execute", args, account: signer });
  const gas = (estimate * BigInt(10_000 + headroomBps)) / 10_000n;
  const txHash = await wallet.writeContract({
    address: mandateAccount,
    abi: mandateAccountAbi,
    functionName: "execute",
    args,
    account: signer,
    chain: wallet.chain,
    gas,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    return { status: "reverted", blockNumber: receipt.blockNumber, txHash, error: "reverted on-chain after a passing simulation" };
  }
  return { status: "filled", txHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

/** Sends `preflight` so a blocked attempt is recorded on-chain as ViolationAttempted (PRD 10.3). */
export async function preflightTight(
  pub: PublicClient,
  wallet: WalletClient,
  signer: Account,
  mandateAccount: Address,
  calls: Call[],
): Promise<{ ok: boolean; txHash: Hex; blockNumber: bigint }> {
  const args = [calls.map((c) => ({ target: c.target, data: c.data }))] as const;
  const { result } = await pub.simulateContract({ address: mandateAccount, abi: mandateAccountAbi, functionName: "preflight", args, account: signer });
  const estimate = await pub.estimateContractGas({ address: mandateAccount, abi: mandateAccountAbi, functionName: "preflight", args, account: signer });
  const txHash = await wallet.writeContract({
    address: mandateAccount,
    abi: mandateAccountAbi,
    functionName: "preflight",
    args,
    account: signer,
    chain: wallet.chain,
    gas: (estimate * 115n) / 100n,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
  return { ok: result, txHash, blockNumber: receipt.blockNumber };
}

/** Average block time over the last `span` blocks, in ms. */
export async function measureBlockTimeMs(client: PublicClient, span = 1000n): Promise<number> {
  const latest = await client.getBlock();
  const earlier = await client.getBlock({ blockNumber: latest.number - span });
  return (Number(latest.timestamp - earlier.timestamp) * 1000) / Number(span);
}

/** Names a revert from Mandate or Perpl, e.g. "CallNotAllowed(0x…, 0x…)" or Perpl's own error; undefined if unknown. */
export function describeRevert(data: Hex | undefined): string | undefined {
  if (!data || data === "0x") return undefined;
  for (const abi of [mandateAccountAbi, perplErrorsAbi] as const) {
    try {
      const e = decodeErrorResult({ abi, data });
      const args = (e.args ?? []).map((a) => (typeof a === "bigint" ? a.toString() : String(a)));
      return `${e.errorName}(${args.join(", ")})`;
    } catch {
      // try the next ABI
    }
  }
  return `unknown error ${data.slice(0, 10)}`;
}

/**
 * A venue revert in plain words, for the screens a human uses (PRD 11.2). Developer text stays in describeRevert.
 * Only errors we have actually seen on Perpl are translated; anything else returns undefined so the caller can fall
 * back rather than invent a reason.
 */
export function venueErrorMessage(data: Hex | undefined): string | undefined {
  if (!data || data === "0x") return undefined;
  try {
    const e = decodeErrorResult({ abi: perplErrorsAbi, data });
    switch (e.errorName) {
      case "TakerOrderSettlementFailed":
        return "Perpl couldn't settle that order. It is usually too big for your balance, or nothing crossed at that price.";
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

export function shortError(err: unknown): string {
  const named = describeRevert(revertData(err));
  if (named) return `reverted: ${named}`;
  const short = (err as { shortMessage?: string }).shortMessage;
  if (short) return short;
  return err instanceof Error ? err.message.split("\n")[0]! : String(err);
}
