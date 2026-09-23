"use client";

import { use, useMemo } from "react";
import { AppHeader } from "@/components/AppHeader";
import { formatBlock, shortAddr, useConfig, usePoll, usd } from "@/lib/client";
import { headroom, observedVsLimit, type AccountView, type LogRecordView } from "@/lib/view";
import s from "./page.module.css";

const SIDE: Record<string, string> = { long: "long", short: "short", close: "close" };

export default function AgentSplitScreen({ params }: { params: Promise<{ account: string }> }) {
  const { account } = use(params);
  const cfg = useConfig();
  const view = usePoll<AccountView>(`/api/accounts/${account}`, 1500);
  const log = usePoll<{ records: LogRecordView[] }>(`/api/accounts/${account}/log`, 1500);
  const records = log?.records ?? [];

  const marketName = useMemo(
    () => (id: number) => cfg?.markets.find((m) => m.perpId === id)?.symbol ?? `Market ${id}`,
    [cfg],
  );
  const bars = view ? headroom(view, marketName) : [];
  // The newest blocked rule pulses once (the one orchestrated motion moment, PRD 11.3).
  const lastBlocked = [...records].reverse().find((r) => r.result === "blocked");

  const equity = view ? Number(view.state.equity) / 1e6 : undefined;

  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <header className={s.head}>
          <div>
            <h1 className="section-heading">Agent</h1>
            <p className="body-secondary">
              <span className="onchain">{shortAddr(account)}</span>
              {view && (
                <>
                  {" "}
                  · Block <span className="onchain">{formatBlock(view.block)}</span>
                </>
              )}
            </p>
          </div>
          {equity !== undefined && (
            <dl className={s.summary}>
              <div>
                <dt>Equity</dt>
                <dd>{usd(equity)}</dd>
              </div>
              <div>
                <dt>Mandate</dt>
                <dd>{view?.closeOnly ? "Close-only" : view?.mandate ? "Active" : "None"}</dd>
              </div>
            </dl>
          )}
        </header>

        <section className={s.split} aria-label="Agent reasoning and chain verdicts">
          <div className={s.labels} aria-hidden>
            <span>Agent</span>
            <span>Chain</span>
          </div>
          {records.length === 0 && (
            <div className={s.row}>
              <div className={s.agent}>
                <p className="body-secondary">Waiting for the agent&rsquo;s first decision.</p>
              </div>
              <div className={s.chain}>
                <p className={s.quiet}>Nothing submitted yet.</p>
              </div>
            </div>
          )}
          {records.map((r, i) => (
            <Row key={`${r.ts}-${i}`} r={r} view={view} marketName={marketName} first={i === 0} last={i === records.length - 1} />
          ))}
        </section>

        {bars.length > 0 && (
          <section className={`card ${s.headroom}`} aria-labelledby="headroom-h">
            <h2 id="headroom-h" className={s.h2}>
              Headroom
            </h2>
            <ul className={s.bars}>
              {bars.map((b) => {
                const pulse = lastBlocked?.violation?.ruleIndex === b.ruleIndex;
                return (
                  <li key={b.ruleIndex} className={s.bar}>
                    <span className={s.barLabel}>{b.label}</span>
                    <span className={s.track} aria-hidden>
                      <span
                        key={pulse ? lastBlocked?.ts : "steady"}
                        className={s.fill}
                        data-state={b.state}
                        data-pulse={pulse || undefined}
                        style={{ width: `${Math.min(100, Math.max(b.used > 0 ? 2 : 0, b.used * 100))}%` }}
                      />
                    </span>
                    <span className={s.barText}>{b.text}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function Row({
  r,
  view,
  marketName,
  first,
  last,
}: {
  r: LogRecordView;
  view?: AccountView;
  marketName: (id: number) => string;
  first: boolean;
  last: boolean;
}) {
  const rule = r.violation ? view?.rules[r.violation.ruleIndex] : undefined;
  const block = r.resultBlock ?? r.block;
  return (
    <div className={s.row} data-first={first || undefined} data-last={last || undefined}>
      <div className={s.agent}>
        <p className={s.block}>
          Block <span className="onchain">{formatBlock(r.block)}</span>
        </p>
        <p className={s.reasoning}>&ldquo;{r.reasoning}&rdquo;</p>
        {r.proposedOrder && (
          <p className={s.proposed}>
            Proposed: {r.proposedOrder.market} {SIDE[r.proposedOrder.side]}
            {r.proposedOrder.side !== "close" && `, ${r.proposedOrder.leverageAfter.toFixed(1)}x`}
          </p>
        )}
      </div>
      <div className={s.chain}>
        <div className={s.verdict} data-result={r.result}>
          <p className={s.blockDark}>
            Block <span className="onchain">{formatBlock(block)}</span>
          </p>
          {r.result === "blocked" && r.violation && (
            <>
              <p className={s.headline} data-tone="breach">
                <span className="onchain">execute()</span> reverted
              </p>
              <p>
                Rule {r.violation.ruleIndex + 1} · {r.violation.rule}
              </p>
              <p>{observedVsLimit(rule?.kind, r.violation.observed, r.violation.limit, marketName)}</p>
              <p className={s.quiet}>Nothing changed on-chain.</p>
            </>
          )}
          {r.result === "filled" && (
            <>
              <p className={s.headline} data-tone="held">
                Filled on Perpl
              </p>
              {r.proposedOrder && <p>{usd(r.proposedOrder.notionalUsd)} notional. Every rule held.</p>}
              {r.txHash && <p className={`onchain ${s.quiet}`}>{shortAddr(r.txHash)}</p>}
            </>
          )}
          {r.result === "no-fill" && (
            <>
              <p className={s.headline}>No fill</p>
              <p className={s.quiet}>The order crossed nothing on Perpl. Position unchanged.</p>
            </>
          )}
          {r.result === "held" && <p className={s.quiet}>No trade submitted.</p>}
          {r.result === "error" && (
            <>
              <p className={s.headline}>Not sent</p>
              <p className={s.quiet}>{r.error}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
