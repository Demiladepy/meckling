// Nansen underwriting (PRD 9): turns Nansen evidence into proposed mandate limits. The method is deliberately a
// small, published table so a backer can see exactly why each limit was chosen.
import { keccak256, toBytes, type Hex } from "viem";
import {
  allowedMarkets,
  lossCooldown,
  maxDrawdown,
  maxLeverage,
  maxNotional,
  orderRateLimit,
  usdToCns,
  type MarketSymbol,
  type NetworkConfig,
  type Rule,
} from "@mandate/common";
import { NansenError, type NansenChain, type NansenClient, type PerpPositionRow } from "./nansen.ts";

export type Regime = "risk-on" | "neutral" | "risk-off";

/** PRD 9 table. Base notional is chosen by the backer. */
export const REGIME_TABLE: Record<Regime, { leverage: number; notionalFactor: number; cooldownBlocks: number }> = {
  "risk-on": { leverage: 5, notionalFactor: 1, cooldownBlocks: 50 },
  neutral: { leverage: 3, notionalFactor: 0.7, cooldownBlocks: 150 },
  "risk-off": { leverage: 1.5, notionalFactor: 0.4, cooldownBlocks: 600 },
};

/** Defaults not in the PRD table, disclosed in every report. */
export const DEFAULTS = {
  orderRateLimit: { maxOrders: 10, windowBlocks: 100 },
  maxDrawdownPct: 5,
  /** Loss that starts a cooldown, as a fraction of base notional. */
  cooldownLossFraction: 0.02,
  riskOnThreshold: 0.25,
  riskOffThreshold: -0.25,
  /** Top-10 holders owning more than this share pushes the score toward risk-off. */
  concentrationPct: 60,
  concentrationPenalty: 0.2,
  /** Net flow (USD, 7d) that maps to a flow score of ~0.76 (tanh(1)). */
  flowScaleUsd: 5_000_000,
};

/** The token whose on-chain flows stand in for each perp's underlying. */
export const UNDERLYING: Record<MarketSymbol, { chain: NansenChain; token: string; label: string }> = {
  BTC: { chain: "ethereum", token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", label: "WBTC on Ethereum" },
  ETH: { chain: "ethereum", token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", label: "WETH on Ethereum" },
  MON: { chain: "monad", token: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", label: "WMON on Monad" },
  SOL: { chain: "solana", token: "So11111111111111111111111111111111111111112", label: "wSOL on Solana" },
};

export interface Signal<T> {
  available: boolean;
  /** Why the signal is missing (for example, not included in the Nansen plan). */
  unavailableReason?: string;
  score?: number;
  data?: T;
}

export interface PositioningEvidence {
  traders: number;
  longUsd: number;
  shortUsd: number;
  netLongRatio: number;
  avgLeverage: number;
  top: Pick<PerpPositionRow, "address_label" | "side" | "position_value_usd" | "leverage" | "upnl_usd">[];
}

export interface FlowEvidence {
  token: string;
  netFlow24hUsd: number;
  netFlow7dUsd: number;
  netFlow30dUsd: number;
}

export interface ConcentrationEvidence {
  token: string;
  top10OwnershipPct: number;
  smartMoneyHolders: number;
}

export interface MarketAssessment {
  symbol: MarketSymbol;
  perpId: number;
  positioning: Signal<PositioningEvidence>;
  flows: Signal<FlowEvidence>;
  concentration: Signal<ConcentrationEvidence>;
  score: number;
  regime: Regime;
  reasons: string[];
}

export interface UnderwritingReport {
  version: 1;
  createdAt: string;
  source: "nansen" | "fixture";
  attribution: "Data: Nansen (nansen.ai)";
  network: string;
  baseNotionalUsd: number;
  method: { table: typeof REGIME_TABLE; defaults: typeof DEFAULTS; weights: { positioning: number; flows: number } };
  markets: MarketAssessment[];
  mandateRegime: Regime;
  proposal: { label: string; limit: string; rule: { kind: number; p1: string; p2: string; p3: string } }[];
  creditsUsed: number;
}

const WEIGHTS = { positioning: 0.6, flows: 0.4 };

function regimeOf(score: number): Regime {
  if (score > DEFAULTS.riskOnThreshold) return "risk-on";
  if (score < DEFAULTS.riskOffThreshold) return "risk-off";
  return "neutral";
}

const STRICTNESS: Record<Regime, number> = { "risk-on": 0, neutral: 1, "risk-off": 2 };

async function signal<T>(fn: () => Promise<{ data: T; credits: number }>, credits: { total: number }): Promise<Signal<T>> {
  try {
    const { data, credits: c } = await fn();
    credits.total += c;
    return { available: true, data };
  } catch (err) {
    const reason =
      err instanceof NansenError ? `Nansen returned ${err.status} for ${err.path}` : err instanceof Error ? err.message : String(err);
    return { available: false, unavailableReason: reason };
  }
}

export function summarizePositioning(rows: PerpPositionRow[]): PositioningEvidence {
  let longUsd = 0;
  let shortUsd = 0;
  let levWeighted = 0;
  for (const r of rows) {
    if (r.side === "Long") longUsd += r.position_value_usd;
    else shortUsd += r.position_value_usd;
    levWeighted += (parseFloat(r.leverage) || 1) * r.position_value_usd;
  }
  const total = longUsd + shortUsd;
  return {
    traders: rows.length,
    longUsd,
    shortUsd,
    netLongRatio: total > 0 ? (longUsd - shortUsd) / total : 0,
    avgLeverage: total > 0 ? levWeighted / total : 0,
    top: rows.slice(0, 5).map(({ address_label, side, position_value_usd, leverage, upnl_usd }) => ({
      address_label,
      side,
      position_value_usd,
      leverage,
      upnl_usd,
    })),
  };
}

export async function assessMarket(
  nansen: NansenClient,
  symbol: MarketSymbol,
  perpId: number,
  credits: { total: number },
): Promise<MarketAssessment> {
  const u = UNDERLYING[symbol];
  const [positioning, flows, concentration] = await Promise.all([
    signal(async () => {
      const res = await nansen.perpPositions({
        token_symbol: symbol,
        label_type: "smart_money",
        pagination: { page: 1, per_page: 100 },
        order_by: [{ field: "position_value_usd", direction: "DESC" }],
      });
      return { data: summarizePositioning(res.data), credits: res.creditsCost ?? 0 };
    }, credits),
    signal(async () => {
      const res = await nansen.smartMoneyNetflow({ chains: [u.chain], filters: { token_address: u.token }, pagination: { page: 1, per_page: 1 } });
      const row = res.data[0];
      if (!row) throw new Error(`no smart-money flow row for ${u.label}`);
      return {
        data: { token: u.label, netFlow24hUsd: row.net_flow_24h_usd, netFlow7dUsd: row.net_flow_7d_usd, netFlow30dUsd: row.net_flow_30d_usd },
        credits: res.creditsCost ?? 0,
      };
    }, credits),
    signal(async () => {
      const [all, smart] = await Promise.all([
        nansen.tokenHolders({
          chain: u.chain,
          token_address: u.token,
          label_type: "all_holders",
          pagination: { page: 1, per_page: 10 },
          order_by: [{ field: "token_amount", direction: "DESC" }],
        }),
        nansen.tokenHolders({ chain: u.chain, token_address: u.token, label_type: "smart_money", pagination: { page: 1, per_page: 100 } }),
      ]);
      return {
        data: {
          token: u.label,
          top10OwnershipPct: all.data.reduce((a, r) => a + r.ownership_percentage, 0),
          smartMoneyHolders: smart.data.length,
        },
        credits: (all.creditsCost ?? 0) + (smart.creditsCost ?? 0),
      };
    }, credits),
  ]);
  return score(symbol, perpId, positioning, flows, concentration);
}

/** Pure scoring step, separated for tests. */
export function score(
  symbol: MarketSymbol,
  perpId: number,
  positioning: Signal<PositioningEvidence>,
  flows: Signal<FlowEvidence>,
  concentration: Signal<ConcentrationEvidence>,
): MarketAssessment {
  const reasons: string[] = [];
  let weighted = 0;
  let weight = 0;

  if (positioning.available && positioning.data && positioning.data.traders > 0) {
    const p = positioning.data;
    positioning.score = p.netLongRatio;
    weighted += WEIGHTS.positioning * p.netLongRatio;
    weight += WEIGHTS.positioning;
    const side = p.netLongRatio >= 0 ? "long" : "short";
    reasons.push(
      `Smart money on Hyperliquid is net ${side} ${symbol}: ${Math.round(Math.abs(p.netLongRatio) * 100)}% skew across ${p.traders} traders at ${p.avgLeverage.toFixed(1)}x average leverage.`,
    );
  }
  if (flows.available && flows.data) {
    const f = flows.data;
    flows.score = Math.tanh(f.netFlow7dUsd / DEFAULTS.flowScaleUsd);
    weighted += WEIGHTS.flows * flows.score;
    weight += WEIGHTS.flows;
    const dir = f.netFlow7dUsd >= 0 ? "inflow" : "outflow";
    reasons.push(`Smart-money 7-day net ${dir} on ${f.token}: $${Math.round(Math.abs(f.netFlow7dUsd)).toLocaleString("en-US")}.`);
  }

  let s = weight > 0 ? weighted / weight : 0;
  if (weight === 0) reasons.push("No directional Nansen signal was available, so the regime defaults to neutral.");

  if (concentration.available && concentration.data) {
    const c = concentration.data;
    concentration.score = c.top10OwnershipPct > DEFAULTS.concentrationPct ? -DEFAULTS.concentrationPenalty : 0;
    if (concentration.score < 0) {
      s += concentration.score;
      reasons.push(`Top 10 holders own ${c.top10OwnershipPct.toFixed(0)}% of ${c.token}, so limits lean tighter.`);
    }
  }

  s = Math.max(-1, Math.min(1, s));
  const regime = regimeOf(s);
  return { symbol, perpId, positioning, flows, concentration, score: s, regime, reasons };
}

/** Proposed rules for a set of assessed markets. Account-wide limits take the strictest regime. */
export function propose(markets: MarketAssessment[], baseNotionalUsd: number) {
  const strictest = markets.reduce<Regime>((acc, m) => (STRICTNESS[m.regime] > STRICTNESS[acc] ? m.regime : acc), "risk-on");
  const t = REGIME_TABLE[strictest];
  const items: { label: string; limit: string; rule: Rule }[] = [
    { label: "Max leverage", limit: `${t.leverage}x (${strictest})`, rule: maxLeverage(t.leverage) },
  ];
  for (const m of markets) {
    const f = REGIME_TABLE[m.regime].notionalFactor;
    const usd = Math.round(baseNotionalUsd * f);
    items.push({ label: `Max ${m.symbol} position`, limit: `$${usd.toLocaleString("en-US")} (${m.regime})`, rule: maxNotional(m.perpId, usdToCns(usd)) });
  }
  items.push({ label: "Allowed markets", limit: markets.map((m) => m.symbol).join(", "), rule: allowedMarkets(markets.map((m) => m.perpId)) });
  items.push({
    label: "Order rate limit",
    limit: `${DEFAULTS.orderRateLimit.maxOrders} orders per ${DEFAULTS.orderRateLimit.windowBlocks} blocks`,
    rule: orderRateLimit(DEFAULTS.orderRateLimit.maxOrders, DEFAULTS.orderRateLimit.windowBlocks),
  });
  const lossUsd = Math.max(1, Math.round(baseNotionalUsd * DEFAULTS.cooldownLossFraction));
  items.push({
    label: "Loss cooldown",
    limit: `${t.cooldownBlocks} blocks after a $${lossUsd} loss`,
    rule: lossCooldown(usdToCns(lossUsd), t.cooldownBlocks),
  });
  items.push({ label: "Max drawdown", limit: `${DEFAULTS.maxDrawdownPct}% from peak`, rule: maxDrawdown(DEFAULTS.maxDrawdownPct) });
  return { regime: strictest, items };
}

export async function underwrite(opts: {
  nansen: NansenClient;
  net: NetworkConfig;
  symbols: MarketSymbol[];
  baseNotionalUsd: number;
  source?: "nansen" | "fixture";
  now?: Date;
}): Promise<{ report: UnderwritingReport; reportHash: Hex; rules: Rule[] }> {
  const credits = { total: 0 };
  const markets = await Promise.all(
    opts.symbols.map((s) => {
      const m = opts.net.markets.find((x) => x.symbol === s);
      if (!m) throw new Error(`Market ${s} not on ${opts.net.key}`);
      return assessMarket(opts.nansen, s, m.perpId, credits);
    }),
  );
  const { regime, items } = propose(markets, opts.baseNotionalUsd);
  const report: UnderwritingReport = {
    version: 1,
    createdAt: (opts.now ?? new Date()).toISOString(),
    source: opts.source ?? "nansen",
    attribution: "Data: Nansen (nansen.ai)",
    network: opts.net.key,
    baseNotionalUsd: opts.baseNotionalUsd,
    method: { table: REGIME_TABLE, defaults: DEFAULTS, weights: WEIGHTS },
    markets,
    mandateRegime: regime,
    proposal: items.map((i) => ({
      label: i.label,
      limit: i.limit,
      rule: { kind: i.rule.kind, p1: i.rule.p1.toString(), p2: i.rule.p2.toString(), p3: i.rule.p3.toString() },
    })),
    creditsUsed: credits.total,
  };
  return { report, reportHash: hashReport(report), rules: items.map((i) => i.rule) };
}

/** Canonical JSON: object keys sorted recursively, no whitespace. The on-chain reportHash is keccak256 of it. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function hashReport(report: UnderwritingReport): Hex {
  return keccak256(toBytes(canonicalJson(report)));
}
