// Shapes returned by the app's API routes (bigints arrive as strings) and formatting for the split screen.
import { RuleKind } from "@mandate/common";

export interface RuleView {
  kind: RuleKind;
  p1: string;
  p2: string;
  p3: string;
  name: string;
  limit: string;
  monitor?: { w0: string; w1: string };
}

export interface MarketView {
  marketId: number;
  size: string;
  mark: string;
  markValid: boolean;
  notional: string;
  upnl: string;
}

export interface AccountView {
  network: string;
  block: string;
  account: string;
  owner: string;
  sessionKey: string;
  closeOnly: boolean;
  mandate: { id: string; reportHash: string; backer: string; operator: string } | null;
  state: { equity: string; totalNotional: string; marginUsed: string; markets: MarketView[] };
  rules: RuleView[];
}

export interface LogRecordView {
  ts: string;
  block: string;
  provider: string;
  intent: { action: "open_long" | "open_short" | "close" | "hold"; market: string; size_usd: number };
  reasoning: string;
  proposedOrder?: { market: string; side: "long" | "short" | "close"; lots: string; limitPrice: number; notionalUsd: number; leverageAfter: number };
  result: "filled" | "blocked" | "held" | "error";
  resultBlock?: string;
  txHash?: string;
  preflightTxHash?: string;
  violation?: { ruleIndex: number; rule: string; observed: string; limit: string; message: string };
  error?: string;
  gasUsed?: string;
}

const x = (bps: number) => `${(bps / 10_000).toFixed(1)}x`;
const dollars = (cns: number) => `$${(cns / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** "Observed 12.0x · Limit 3.0x" in the rule's own unit. */
export function observedVsLimit(kind: RuleKind | undefined, observed: string, limit: string, marketName?: (id: number) => string): string {
  const o = Number(observed);
  const l = Number(limit);
  switch (kind) {
    case RuleKind.MaxLeverage:
      return `Observed ${x(o)} · Limit ${x(l)}`;
    case RuleKind.MaxNotionalPerMarket:
      return `Observed ${dollars(o)} · Limit ${dollars(l)}`;
    case RuleKind.AllowedMarkets:
      return `${marketName?.(o) ?? `Market ${o}`} is not allowed`;
    case RuleKind.OrderRateLimit:
      return `Order ${o} · Limit ${l} per window`;
    case RuleKind.LossCooldown:
      return `${l - o} of ${l} cooldown blocks left`;
    case RuleKind.MaxDrawdown:
      return `Drawdown ${(o / 100).toFixed(2)}% · Limit ${(l / 100).toFixed(2)}%`;
    default:
      return `Observed ${observed} · Limit ${limit}`;
  }
}

export interface Headroom {
  ruleIndex: number;
  label: string;
  /** 0..1+ of the limit used. */
  used: number;
  text: string;
  state: "held" | "pending" | "breach";
}

/** Headroom per rule from live account state and monitors. */
export function headroom(a: AccountView, marketName: (id: number) => string): Headroom[] {
  const equity = Number(a.state.equity);
  const notional = Number(a.state.totalNotional);
  const block = Number(a.block);
  const out: Headroom[] = [];
  a.rules.forEach((r, i) => {
    const p1 = Number(r.p1);
    const p2 = Number(r.p2);
    const w0 = Number(r.monitor?.w0 ?? 0);
    const w1 = Number(r.monitor?.w1 ?? 0);
    switch (r.kind) {
      case RuleKind.MaxLeverage: {
        const lev = equity > 0 ? (notional * 10_000) / equity : 0;
        out.push({ ruleIndex: i, label: "Leverage", used: lev / p1, text: `${(lev / 10_000).toFixed(1)} / ${(p1 / 10_000).toFixed(1)}x`, state: lev > p1 ? "breach" : "held" });
        break;
      }
      case RuleKind.MaxNotionalPerMarket: {
        const n = Number(a.state.markets.find((m) => m.marketId === p1)?.notional ?? 0);
        out.push({ ruleIndex: i, label: `${marketName(p1)} size`, used: n / p2, text: `${dollars(n)} / ${dollars(p2)}`, state: n > p2 ? "breach" : "held" });
        break;
      }
      case RuleKind.OrderRateLimit: {
        const inWindow = w1 > 0 && block < w0 + p2 ? w1 : 0;
        out.push({ ruleIndex: i, label: "Orders", used: inWindow / p1, text: `${inWindow} / ${p1} in window`, state: "held" });
        break;
      }
      case RuleKind.LossCooldown: {
        const since = w0 > 0 ? block - (w0 - 1) : Infinity;
        const left = since >= p2 ? 0 : p2 - since;
        out.push({ ruleIndex: i, label: "Cooldown", used: left / p2, text: left ? `${left} blocks left` : "ready", state: left ? "pending" : "held" });
        break;
      }
      case RuleKind.MaxDrawdown: {
        const dd = w0 > 0 && equity < w0 ? ((w0 - equity) * 10_000) / w0 : 0;
        out.push({ ruleIndex: i, label: "Drawdown", used: dd / p1, text: `${(dd / 100).toFixed(1)} / ${(p1 / 100).toFixed(1)}%`, state: dd > p1 ? "breach" : "held" });
        break;
      }
    }
  });
  return out;
}
