import type { MarketAssessment } from "underwriter";
import { usd } from "@/lib/client";
import s from "./page.module.css";

const REGIME: Record<MarketAssessment["regime"], string> = { "risk-on": "Risk-on", neutral: "Neutral", "risk-off": "Risk-off" };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Missing({ what, reason }: { what: string; reason?: string }) {
  return <Row label={what} value={reason?.includes("403") ? "Not in this Nansen plan" : "Not available"} />;
}

/** One market's Nansen evidence, the score it produced, and the regime that sets its limits. */
export function EvidenceCard({ market: m }: { market: MarketAssessment }) {
  const p = m.positioning;
  const f = m.flows;
  const c = m.concentration;
  return (
    <article className={`card ${s.evidenceCard}`}>
      <header className={s.evidenceHead}>
        <h3>{m.symbol}</h3>
        <span className={s.regime}>{REGIME[m.regime]}</span>
      </header>
      <ul className={s.reasons}>
        {m.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <dl className={s.stats}>
        {p.available && p.data ? (
          <>
            <Row label="Smart-money perp skew" value={`${Math.round(p.data.netLongRatio * 100)}% ${p.data.netLongRatio >= 0 ? "long" : "short"}`} />
            <Row label="Average leverage" value={`${p.data.avgLeverage.toFixed(1)}x across ${p.data.traders}`} />
          </>
        ) : (
          <Missing what="Smart-money perp positioning" reason={p.unavailableReason} />
        )}
        {f.available && f.data ? (
          <Row label="Smart-money net flow, 7 days" value={`${f.data.netFlow7dUsd < 0 ? "−" : "+"}${usd(Math.abs(f.data.netFlow7dUsd), 0)}`} />
        ) : (
          <Missing what="Smart-money net flow" reason={f.unavailableReason} />
        )}
        {c.available && c.data ? (
          <Row label="Top 10 holders own" value={`${c.data.top10OwnershipPct.toFixed(0)}%`} />
        ) : (
          <Missing what="Holder concentration" reason={c.unavailableReason} />
        )}
        <Row label="Score" value={m.score.toFixed(2)} />
      </dl>
    </article>
  );
}
