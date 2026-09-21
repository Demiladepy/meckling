// viem helpers shared by the agent, keeper and app: read account state, simulate and send `execute` with a tight
// gas limit (Monad charges the gas limit, not gas used), and measure block time at startup (PRD rule 6).
import {
  BaseError,
  ContractFunctionRevertedError,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { mandateAccountAbi, mandateRegistryAbi, perplAdapterAbi } from "./abis.ts";
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

/** Pulls revert data out of a viem error, for decodeViolation. */
export function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) return reverted.raw;
  const withData = err.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null;
  return withData?.data;
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

function shortError(err: unknown): string {
  if (err instanceof BaseError) return err.shortMessage;
  return err instanceof Error ? err.message : String(err);
}
