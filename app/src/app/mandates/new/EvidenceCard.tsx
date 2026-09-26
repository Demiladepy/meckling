import type { MarketAssessment } from "underwriter";
import { usd } from "@/lib/client";
import s from "./page.module.css";

const REGIME: Record<MarketAssessment["regime"], string> = {
  "risk-on": "Risk-on",
  neutral: "Neutral",
  "risk-off": "Risk-off",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Missing({ what, reason }: { what: string; reason?: string }) {
  const plan = reason?.includes("403") || reason?.includes("insufficient");
  return <Row label={what} value={plan ? "Not in this Nansen plan" : "Unavailable"} />;
}

/** One market's Nansen evidence, the score it produced, and the regime that sets its limits. */
export function EvidenceCard({ market: m }: { market: MarketAssessment }) {
  const p = m.positioning;
  const f = m.flows;
  const c = m.concentration;
  return (
    <article className={`card ${s.evidenceCard}`} data-regime={m.regime}>
      <header className={s.evidenceHead}>
        <div>
          <h3>{m.symbol}</h3>
          <p className={s.scoreLine}>
            Score <span>{m.score.toFixed(2)}</span>
          </p>
        </div>
        <span className={s.regime} data-regime={m.regime}>
          {REGIME[m.regime]}
        </span>
      </header>
      <ul className={s.reasons}>
        {m.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <dl className={s.stats}>
        {p.available && p.data ? (
          <>
            <Row
              label="Smart-money perp skew"
              value={`${Math.round(p.data.netLongRatio * 100)}% ${p.data.netLongRatio >= 0 ? "net long" : "net short"}`}
            />
            <Row label="Average leverage" value={`${p.data.avgLeverage.toFixed(1)}× across ${p.data.traders} accounts`} />
            <Row label="Long / short notional" value={`${usd(p.data.longUsd, 0)} / ${usd(p.data.shortUsd, 0)}`} />
          </>
        ) : (
          <Missing what="Smart-money perp positioning" reason={p.unavailableReason} />
        )}
        {f.available && f.data ? (
          <>
            <Row
              label="Net flow · 7 days"
              value={`${f.data.netFlow7dUsd < 0 ? "−" : "+"}${usd(Math.abs(f.data.netFlow7dUsd), 0)} on ${f.data.token}`}
            />
            <Row
              label="Net flow · 24h / 30d"
              value={`${usd(f.data.netFlow24hUsd, 0)} / ${usd(f.data.netFlow30dUsd, 0)}`}
            />
          </>
        ) : (
          <Missing what="Smart-money net flow" reason={f.unavailableReason} />
        )}
        {c.available && c.data ? (
          <>
            <Row label="Top 10 holders" value={`${c.data.top10OwnershipPct.toFixed(0)}% of ${c.data.token}`} />
            <Row label="Smart-money holders" value={String(c.data.smartMoneyHolders)} />
          </>
        ) : (
          <Missing what="Holder concentration" reason={c.unavailableReason} />
        )}
      </dl>
    </article>
  );
}
