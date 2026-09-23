// The keeper's checks (PRD section 10). This module is the single source of truth for what a keeper does; the
// fallback relayer runs it directly, and the CRE workflow runs the same functions inside its own runtime, so the two
// can never drift apart.
//
// Every check is recomputed on-chain by BondVault before it acts, so a keeper can never cause a false breach: the
// worst it can do is waste its own gas.
import {
  RuleKind,
  bondVaultAbi,
  drawdownBps,
  isDrawdownBreached,
  mandateAccountAbi,
  mandateRegistryAbi,
  oracleGuardAbi,
  readAccountState,
  readMonitors,
  readRules,
  shortError,
  type Deployment,
  type Rule,
} from "@mandate/common";
import type { Account, Address, Hex, PublicClient, WalletClient } from "viem";

export interface MarketRuleStatus {
  ruleIndex: number;
  peak: bigint;
  equity: bigint;
  drawdownBps: number;
  limitBps: number;
  breached: boolean;
}

export interface AccountCheck {
  account: Address;
  block: bigint;
  active: boolean;
  closeOnly: boolean;
  marksTrusted: boolean;
  statuses: MarketRuleStatus[];
  /** Set when the account's equity has risen above the stored peak, so the monitor is behind. */
  peakStale: boolean;
}

export type KeeperAction =
  | { kind: "none" }
  | { kind: "poked"; txHash: Hex }
  | { kind: "flagged"; ruleIndex: number; txHash: Hex; blockNumber: bigint }
  | { kind: "flag-rejected"; ruleIndex: number; reason: string }
  | { kind: "slashed"; breachId: number; txHash: Hex }
  | { kind: "error"; reason: string };

/** Finds every account the registry has ever issued a mandate for. */
export async function discoverAccounts(pub: PublicClient, dep: Deployment, chunk = 50_000n): Promise<Address[]> {
  const latest = await pub.getBlockNumber();
  const accounts: Address[] = [];
  for (let from = BigInt(dep.startBlock); from <= latest; from += chunk) {
    const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;
    const logs = await pub.getContractEvents({
      address: dep.mandateRegistry,
      abi: mandateRegistryAbi,
      eventName: "MandateCreated",
      fromBlock: from,
      toBlock: to,
    });
    for (const l of logs) {
      const a = (l.args as { account?: Address }).account;
      if (a && !accounts.includes(a)) accounts.push(a);
    }
  }
  return accounts;
}

/** Reads everything a keeper needs about one account, without sending anything. */
export async function checkAccount(pub: PublicClient, dep: Deployment, account: Address): Promise<AccountCheck> {
  const [block, { exists, active, rules }, state, closeOnly, marksTrusted] = await Promise.all([
    pub.getBlockNumber(),
    readRules(pub, dep.mandateRegistry, account),
    readAccountState(pub, dep.perplAdapter, account),
    pub.readContract({ address: account, abi: mandateAccountAbi, functionName: "closeOnly" }),
    pub.readContract({ address: dep.oracleGuard, abi: oracleGuardAbi, functionName: "accountMarksTrusted", args: [account] }),
  ]);
  if (!exists) return { account, block, active: false, closeOnly, marksTrusted, statuses: [], peakStale: false };

  const monitors = await readMonitors(pub, account, rules.length);
  const statuses: MarketRuleStatus[] = [];
  let peakStale = false;
  rules.forEach((r: Rule, i: number) => {
    if (r.kind !== RuleKind.MaxDrawdown) return;
    const peak = monitors[i]!.w0;
    const equity = state.equity;
    const eq = equity > 0n ? equity : 0n;
    if (eq > peak) peakStale = true;
    statuses.push({
      ruleIndex: i,
      peak,
      equity,
      drawdownBps: drawdownBps(peak, equity),
      limitBps: Number(r.p1),
      breached: isDrawdownBreached(peak, equity, r.p1),
    });
  });
  return { account, block, active, closeOnly, marksTrusted, statuses, peakStale };
}

export interface ActOptions {
  /** Update the drawdown peak when equity has risen above it (PRD 7.4: updated on every keeper check). */
  poke?: boolean;
  /** Slash breaches whose dispute window has passed. */
  slash?: boolean;
  gasHeadroomBps?: bigint;
}

/**
 * Decides and sends. Flags only when the rule is broken *and* the oracle guard trusts every mark, so the keeper does
 * not waste gas on a transaction BondVault would reject.
 */
export async function actOnAccount(
  pub: PublicClient,
  wallet: WalletClient,
  signer: Account,
  dep: Deployment,
  check: AccountCheck,
  opts: ActOptions = {},
): Promise<KeeperAction> {
  const headroom = opts.gasHeadroomBps ?? 1_500n;
  const send = async (req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => {
    const call = { ...req, account: signer } as never;
    await pub.simulateContract(call);
    const gas = ((await pub.estimateContractGas(call)) * (10_000n + headroom)) / 10_000n;
    const hash = await wallet.writeContract({ ...(req as object), account: signer, chain: wallet.chain, gas } as never);
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${req.functionName} reverted (${hash})`);
    return { hash, blockNumber: receipt.blockNumber };
  };

  const breach = check.statuses.find((s) => s.breached);
  if (breach && check.active && !check.closeOnly) {
    if (!check.marksTrusted) {
      return { kind: "flag-rejected", ruleIndex: breach.ruleIndex, reason: "oracle guard does not trust the marks" };
    }
    try {
      const { hash, blockNumber } = await send({
        address: dep.bondVault,
        abi: bondVaultAbi,
        functionName: "flagBreach",
        args: [check.account, BigInt(breach.ruleIndex)],
      });
      return { kind: "flagged", ruleIndex: breach.ruleIndex, txHash: hash, blockNumber };
    } catch (err) {
      return { kind: "flag-rejected", ruleIndex: breach.ruleIndex, reason: shortError(err) };
    }
  }

  if (opts.slash) {
    const open = await pub.readContract({ address: dep.bondVault, abi: bondVaultAbi, functionName: "openBreachOf", args: [check.account] });
    if (open > 0n) {
      const breachId = open - 1n;
      try {
        const { hash } = await send({ address: dep.bondVault, abi: bondVaultAbi, functionName: "slash", args: [breachId] });
        return { kind: "slashed", breachId: Number(breachId), txHash: hash };
      } catch {
        // The dispute window is still open, or a dispute is unresolved. Try again next round.
      }
    }
  }

  if (opts.poke && check.peakStale && check.active) {
    try {
      const { hash } = await send({ address: check.account, abi: mandateAccountAbi, functionName: "poke", args: [] });
      return { kind: "poked", txHash: hash };
    } catch (err) {
      return { kind: "error", reason: shortError(err) };
    }
  }
  return { kind: "none" };
}
