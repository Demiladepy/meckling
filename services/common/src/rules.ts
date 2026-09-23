// Mandate rules in TypeScript: mirrors contracts/src/rules/RuleTypes.sol, plus plain-language copy (PRD 11.2).
import { decodeErrorResult, type Hex } from "viem";
import { mandateAccountAbi } from "./abis.ts";
import { cnsToUsd } from "./perpl.ts";
import type { NetworkConfig } from "./networks.ts";

export const RuleKind = {
  MaxLeverage: 0,
  MaxNotionalPerMarket: 1,
  AllowedMarkets: 2,
  OrderRateLimit: 3,
  LossCooldown: 4,
  MaxDrawdown: 5,
} as const;
export type RuleKind = (typeof RuleKind)[keyof typeof RuleKind];

export interface Rule {
  kind: RuleKind;
  p1: bigint;
  p2: bigint;
  p3: bigint;
}

export const RULE_NAMES: Record<RuleKind, string> = {
  [RuleKind.MaxLeverage]: "Max leverage",
  [RuleKind.MaxNotionalPerMarket]: "Max position size",
  [RuleKind.AllowedMarkets]: "Allowed markets",
  [RuleKind.OrderRateLimit]: "Order rate limit",
  [RuleKind.LossCooldown]: "Loss cooldown",
  [RuleKind.MaxDrawdown]: "Max drawdown",
};

export const isMarketRule = (k: RuleKind) => k === RuleKind.MaxDrawdown;

// ------------------------------------------------------------------ constructors

export const maxLeverage = (x: number): Rule => ({ kind: RuleKind.MaxLeverage, p1: BigInt(Math.round(x * 10_000)), p2: 0n, p3: 0n });
export const maxNotional = (perpId: number, cns: bigint): Rule => ({ kind: RuleKind.MaxNotionalPerMarket, p1: BigInt(perpId), p2: cns, p3: 0n });
export const allowedMarkets = (perpIds: number[]): Rule => ({
  kind: RuleKind.AllowedMarkets,
  p1: perpIds.reduce((acc, id) => acc | (1n << BigInt(id)), 0n),
  p2: 0n,
  p3: 0n,
});
export const orderRateLimit = (maxOrders: number, windowBlocks: number): Rule => ({
  kind: RuleKind.OrderRateLimit,
  p1: BigInt(maxOrders),
  p2: BigInt(windowBlocks),
  p3: 0n,
});
export const lossCooldown = (lossCns: bigint, blocks: number): Rule => ({ kind: RuleKind.LossCooldown, p1: lossCns, p2: BigInt(blocks), p3: 0n });
export const maxDrawdown = (pct: number): Rule => ({ kind: RuleKind.MaxDrawdown, p1: BigInt(Math.round(pct * 100)), p2: 0n, p3: 0n });

// ------------------------------------------------------------------ copy

function marketsIn(net: NetworkConfig | undefined, bitmap: bigint): string {
  if (!net) return `bitmap ${bitmap.toString(2)}`;
  const names = net.markets.filter((m) => (bitmap >> BigInt(m.perpId)) & 1n).map((m) => m.symbol);
  return names.length ? names.join(", ") : "none";
}

function marketName(net: NetworkConfig | undefined, perpId: bigint): string {
  return net?.markets.find((m) => BigInt(m.perpId) === perpId)?.symbol ?? `market ${perpId}`;
}

const x = (bps: bigint) => `${(Number(bps) / 10_000).toFixed(1).replace(/\.0$/, "")}x`;
const usd = (cns: bigint) => `$${cnsToUsd(cns).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** The limit in words, e.g. "3x", "$2,000 on BTC", "150 blocks after a $10 loss". */
export function describeLimit(r: Rule, net?: NetworkConfig): string {
  switch (r.kind) {
    case RuleKind.MaxLeverage:
      return x(r.p1);
    case RuleKind.MaxNotionalPerMarket:
      return `${usd(r.p2)} on ${marketName(net, r.p1)}`;
    case RuleKind.AllowedMarkets:
      return marketsIn(net, r.p1);
    case RuleKind.OrderRateLimit:
      return `${r.p1} orders per ${r.p2} blocks`;
    case RuleKind.LossCooldown:
      return `${r.p2} blocks after a ${usd(r.p1)} loss`;
    case RuleKind.MaxDrawdown:
      return `${Number(r.p1) / 100}% from peak`;
  }
}

export interface Violation {
  ruleIndex: number;
  observed: bigint;
  limit: bigint;
}

/** Decodes MandateViolation from revert data; undefined for any other error. */
export function decodeViolation(data: Hex | undefined): Violation | undefined {
  if (!data) return undefined;
  try {
    const err = decodeErrorResult({ abi: mandateAccountAbi, data });
    if (err.errorName !== "MandateViolation") return undefined;
    const [ruleIndex, observed, limit] = err.args as readonly [bigint, bigint, bigint];
    return { ruleIndex: Number(ruleIndex), observed, limit };
  } catch {
    return undefined;
  }
}

/** PRD 11.2: say what happened and what the limit is. */
export function violationMessage(v: Violation, rule: Rule, net?: NetworkConfig): string {
  switch (rule.kind) {
    case RuleKind.MaxLeverage:
      return `Blocked: this trade would put you at ${x(v.observed)} leverage. Your limit is ${x(v.limit)}.`;
    case RuleKind.MaxNotionalPerMarket:
      return `Blocked: this trade would make your ${marketName(net, rule.p1)} position ${usd(v.observed)}. Your limit is ${usd(v.limit)}.`;
    case RuleKind.AllowedMarkets:
      return `Blocked: ${marketName(net, v.observed)} isn't an allowed market. Allowed: ${marketsIn(net, rule.p1)}.`;
    case RuleKind.OrderRateLimit:
      return `Blocked: this would be order ${v.observed} in the current window. Your limit is ${v.limit} per ${rule.p2} blocks.`;
    case RuleKind.LossCooldown:
      return `Blocked: you're in a loss cooldown. ${v.limit - v.observed} blocks left of ${v.limit}.`;
    case RuleKind.MaxDrawdown:
      return `Breach: equity is ${Number(v.observed) / 100}% below its peak. Your limit is ${Number(v.limit) / 100}%.`;
  }
}

/** Shape viem expects for the Solidity Rule tuple. */
export const toAbiRule = (r: Rule) => ({ kind: r.kind, p1: r.p1, p2: r.p2, p3: r.p3 });

// ------------------------------------------------------------------ market-rule math
//
// Shared by both keepers (relayer and CRE workflow) and by the app, so every surface computes a drawdown the same
// way the contracts do (MaxDrawdownRule.sol: observed = (peak - equity) / peak, breached when equity * 10000 <
// peak * (10000 - limit)).

/** Drawdown from the equity peak, in bps. 0 when at or above the peak. */
export function drawdownBps(peak: bigint, equity: bigint): number {
  const eq = equity > 0n ? equity : 0n;
  if (peak === 0n || eq >= peak) return 0;
  return Number(((peak - eq) * 10_000n) / peak);
}

/** True when the drawdown rule is broken, using the contract's exact comparison. */
export function isDrawdownBreached(peak: bigint, equity: bigint, limitBps: bigint): boolean {
  const eq = equity > 0n ? equity : 0n;
  return peak > 0n && eq * 10_000n < peak * (10_000n - limitBps);
}
