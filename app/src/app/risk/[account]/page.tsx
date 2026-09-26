"use client";

// Risk screen (PRD 11.1): one Perpl account's live risk — leverage, equity against its peak, headroom on every rule
// and the breaches that already happened. Live numbers come from chain state; anything historical comes from the
// Envio indexer, because Monad full nodes serve none.
import { use, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { formatBlock, shortAddr, usd, useConfig, usePoll } from "@/lib/client";
import { headroom, observedVsLimit, type AccountView, type HistoryView, type RuleView } from "@/lib/view";
import s from "./page.module.css";

/** The alert threshold lives in this browser only: a reminder for the person watching, not a promise. */
const ALERT_KEY = "mandate.alert.drawdownPct";

export default function RiskScreen({ params }: { params: Promise<{ account: string }> }) {
  const { account } = use(params);
  const cfg = useConfig();
  const view = usePoll<AccountView>(`/api/accounts/${account}`, 3000);
  const history = usePoll<HistoryView>(`/api/accounts/${account}/history`, 15000);
  const track = history?.indexer ? history.trackRecord : undefined;

  const [alertPct, setAlertPct] = useState(5);
  useEffect(() => {
    const saved = Number(localStorage.getItem(ALERT_KEY));
    if (saved > 0) setAlertPct(saved);
  }, []);

  const marketName = useMemo(
    () => (id: number) => cfg?.markets.find((m) => m.perpId === id)?.symbol ?? `Market ${id}`,
    [cfg],
  );

  const equity = view ? Number(view.state.equity) / 1e6 : undefined;
  const notional = view ? Number(view.state.totalNotional) / 1e6 : undefined;
  const leverage = equity && equity > 0 ? (notional ?? 0) / equity : 0;
  const peak = peakOf(view, track);
  const drawdownPct = peak && equity !== undefined && equity < peak ? ((peak - equity) / peak) * 100 : 0;
  const bars = view ? headroom(view, marketName) : [];
  const tripped = drawdownPct >= alertPct;

  function saveAlert(pct: number) {
    setAlertPct(pct);
    try {
      localStorage.setItem(ALERT_KEY, String(pct));
    } catch {
      // private windows refuse storage; the threshold still applies for this session
    }
  }

  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <header className={s.head}>
          <div>
            <h1 className="section-heading">Risk</h1>
            <p className="body-secondary">
              <span className="onchain">{shortAddr(account)}</span>
              {view && (
                <>
                  {" "}
                  · Block <span className="onchain">{formatBlock(view.block)}</span>
                  {view.closeOnly && " · Close-only"}
                </>
              )}
            </p>
          </div>
        </header>

        {tripped && (
          <p className={s.alert} role="status">
            Down {drawdownPct.toFixed(1)}% from the peak, past your {alertPct}% alert.
          </p>
        )}

        <section className={s.tiles}>
          <Tile label="Equity" value={equity === undefined ? "—" : usd(equity)} note={peak ? `Peak ${usd(peak)}` : undefined} />
          <Tile label="Leverage" value={`${leverage.toFixed(1)}x`} note={notional === undefined ? undefined : `${usd(notional)} open`} />
          <Tile
            label="Drawdown"
            value={`${drawdownPct.toFixed(1)}%`}
            note={track ? `Worst ${(track.maxDrawdownBps / 100).toFixed(1)}%` : undefined}
            tone={drawdownPct > 0 ? "warn" : undefined}
          />
          <Tile
            label="Trades blocked"
            value={track ? String(track.violationsAttempted) : "—"}
            note={track ? `${track.executions} allowed` : "Needs the indexer"}
          />
        </section>

        {bars.length > 0 && (
          <section className={`card ${s.block}`} aria-labelledby="headroom-h">
            <h2 id="headroom-h" className={s.h2}>
              Headroom
            </h2>
            <ul className={s.bars}>
              {bars.map((b) => (
                <li key={b.ruleIndex} className={s.bar}>
                  <span className={s.barLabel}>{b.label}</span>
                  <span className={s.track} aria-hidden>
                    <span className={s.fill} data-state={b.state} style={{ width: `${Math.min(100, Math.max(b.used > 0 ? 2 : 0, b.used * 100))}%` }} />
                  </span>
                  <span className={s.barText}>{b.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={`card ${s.block}`} aria-labelledby="alert-h">
          <h2 id="alert-h" className={s.h2}>
            Alert me at
          </h2>
          <div className={s.choices}>
            {[2, 5, 10, 20].map((p) => (
              <button key={p} type="button" data-on={alertPct === p || undefined} onClick={() => saveAlert(p)}>
                {p}%
              </button>
            ))}
          </div>
          <p className={s.fine}>Drawdown from the equity peak. Kept in this browser, and shown here while the screen is open.</p>
        </section>

        <section className={`card ${s.block}`} aria-labelledby="breach-h">
          <h2 id="breach-h" className={s.h2}>
            Breaches
          </h2>
          {view && view.breaches.length === 0 && <p className={s.fine}>No rule has been broken by the market.</p>}
          <ul className={s.breaches}>
            {view?.breaches.map((b) => {
              const rule: RuleView | undefined = view.rules[b.ruleIndex];
              return (
                <li key={b.id}>
                  <p className={s.breachHead}>
                    <a href={`/breaches/${account}/${b.id}`}>
                      {rule?.name ?? "Market rule"} · block <span className="onchain">{formatBlock(b.flaggedAtBlock)}</span>
                    </a>
                  </p>
                  <p className={s.fine}>{observedVsLimit(rule?.kind, b.observed, b.limit)}</p>
                  <p className={s.fine}>
                    {b.slashed
                      ? `Bond paid the backer ${usd(Number(b.loss) / 1e6)}.`
                      : b.disputed
                        ? "Disputed, waiting on the arbiter."
                        : "Dispute window open."}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </>
  );
}

/** The peak the drawdown rule is measured against: its own monitor if one exists, else the indexer's curve. */
function peakOf(view: AccountView | undefined, track: { peakEquity: string | null } | undefined): number | undefined {
  const fromMonitor = view?.rules.find((r) => r.monitor && Number(r.monitor.w0) > 0)?.monitor?.w0;
  if (fromMonitor && Number(fromMonitor) > 0) return Number(fromMonitor) / 1e6;
  if (track?.peakEquity) return Number(track.peakEquity) / 1e6;
  return undefined;
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warn" }) {
  return (
    <div className={`card ${s.tile}`} data-tone={tone}>
      <p className={s.tileLabel}>{label}</p>
      <p className={s.tileValue}>{value}</p>
      {note && <p className={s.fine}>{note}</p>}
    </div>
  );
}
