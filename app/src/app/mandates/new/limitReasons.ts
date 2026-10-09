import { RuleKind, cnsToUsd, type Rule } from "@mandate/common";
import type { MarketAssessment, UnderwritingReport } from "underwriter";

/** Pick the strongest single Nansen line for a market (flows / positioning first). */
function primaryReason(m: MarketAssessment): string {
  const flow = m.reasons.find((r) => /net (inflow|outflow|flow)/i.test(r));
  if (flow) return flow.replace(/\.$/, "");
  const pos = m.reasons.find((r) => /net (long|short)/i.test(r));
  if (pos) return pos.replace(/\.$/, "");
  return (m.reasons[0] ?? `Regime ${m.regime} from available Nansen signals`).replace(/\.$/, "");
}

function strictestMarkets(report: UnderwritingReport): MarketAssessment[] {
  return report.markets.filter((m) => m.regime === report.mandateRegime);
}

/**
 * One causal line per proposed limit: UI-only, does not change the hashed report.
 * Format judges expect: "$160 on BTC: smart-money netflow turned negative over 7 days."
 */
export function reasonsForLimits(report: UnderwritingReport, rules: Rule[]): string[] {
  const strict = strictestMarkets(report);
  const accountLine =
    strict.length > 0
      ? `${strict.map((m) => m.symbol).join("/")} set the account to ${report.mandateRegime}: ${primaryReason(strict[0]!)}`
      : `Account regime ${report.mandateRegime}`;

  return rules.map((r) => {
    switch (r.kind) {
      case RuleKind.MaxNotionalPerMarket: {
        const m = report.markets.find((x) => BigInt(x.perpId) === r.p1);
        if (!m) return accountLine;
        const usd = Math.round(cnsToUsd(r.p2));
        return `$${usd.toLocaleString("en-US")} on ${m.symbol}: ${primaryReason(m)}`;
      }
      case RuleKind.MaxLeverage:
        return `${Number(r.p1) / 10_000}x max leverage: ${accountLine}`;
      case RuleKind.AllowedMarkets:
        return `Only ${report.markets.map((m) => m.symbol).join(", ")}: the markets you chose, each sized by Nansen`;
      case RuleKind.OrderRateLimit:
        return `${r.p1} orders per ${r.p2} blocks: the default guard against spraying orders`;
      case RuleKind.LossCooldown:
        return `${r.p2} blocks after a loss: ${accountLine}`;
      case RuleKind.MaxDrawdown:
        return `${Number(r.p1) / 100}% from peak: a market rule, and a breach is paid from the operator's bond`;
      default:
        return accountLine;
    }
  });
}
