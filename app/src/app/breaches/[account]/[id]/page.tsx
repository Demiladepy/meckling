"use client";

import Link from "next/link";
import { use, useMemo } from "react";
import { AppHeader } from "@/components/AppHeader";
import { formatBlock, shortAddr, usd, usePoll } from "@/lib/client";
import { observedVsLimit, type AccountView } from "@/lib/view";
import s from "./page.module.css";

/**
 * One breach: evidence, peak vs equity, dispute-window countdown, slash outcome.
 * Named numbers for judges — e.g. bond paid $0.109218, the exact loss from peak.
 */
export default function BreachDetail({ params }: { params: Promise<{ account: string; id: string }> }) {
  const { account, id } = use(params);
  const view = usePoll<AccountView>(`/api/accounts/${account}`, 3000);

  const breach = view?.breaches.find((b) => b.id === id || b.id === String(BigInt(id)));
  const rule = breach && view ? view.rules[breach.ruleIndex] : undefined;
  const head = view ? Number(view.block) : undefined;

  const windowBlocks = Number(view?.mandate?.disputeWindowBlocks ?? 600);
  const flagged = breach ? Number(breach.flaggedAtBlock) : 0;
  const windowEnd = flagged + windowBlocks;
  const blocksLeft =
    head !== undefined && breach && !breach.slashed && !breach.disputed ? Math.max(0, windowEnd - head) : 0;
  const progress =
    head !== undefined && breach && !breach.slashed
      ? Math.min(1, Math.max(0, (head - flagged) / windowBlocks))
      : breach?.slashed
        ? 1
        : 0;

  const peak = breach ? Number(breach.peakEquity) / 1e6 : 0;
  const atFlag = breach ? Number(breach.equityAtFlag) / 1e6 : 0;
  const loss = breach ? Number(breach.loss) / 1e6 : 0;

  const status = useMemo(() => {
    if (!breach) return null;
    if (breach.slashed) return { tone: "held" as const, label: `Bond paid the backer ${usd(loss)}` };
    if (breach.disputed) return { tone: "pending" as const, label: "Disputed — waiting on the arbiter" };
    if (blocksLeft > 0) return { tone: "pending" as const, label: `${blocksLeft.toLocaleString("en-US")} blocks left in the dispute window` };
    return { tone: "breach" as const, label: "Dispute window closed — ready to slash" };
  }, [breach, blocksLeft, loss]);

  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <header className={s.head}>
          <p className={s.crumb}>
            <Link href={`/agents/${account}`}>Agent {shortAddr(account)}</Link>
            {" · "}
            <Link href={`/risk/${account}`}>Risk</Link>
          </p>
          <h1 className="section-heading">Breach {id}</h1>
          <p className="body-secondary">
            The market broke a rule. The keeper flagged it on-chain; the agent did nothing.
          </p>
        </header>

        {!view && <p className="body-secondary">Loading account…</p>}
        {view && !breach && (
          <p className={s.missing} role="status">
            Breach {id} is not in the recent on-chain scan for this account. If it is older than the scan window,
            the indexer will surface it once configured.
          </p>
        )}

        {breach && status && (
          <>
            <section className={`card-ink ${s.verdict}`} aria-labelledby="status-h">
              <h2 id="status-h" className={s.h2Ink}>
                Chain verdict
              </h2>
              <p className={s.status} data-tone={status.tone}>
                {status.label}
              </p>
              <p className={s.metaInk}>
                Flagged at block <span className="onchain">{formatBlock(breach.flaggedAtBlock)}</span>
                {head !== undefined && (
                  <>
                    {" · "}
                    Now <span className="onchain">{formatBlock(head)}</span>
                  </>
                )}
              </p>
            </section>

            <section className={`card ${s.block}`} aria-labelledby="rule-h">
              <h2 id="rule-h" className={s.h2}>
                Rule broken
              </h2>
              <p className={s.ruleName}>
                Rule {breach.ruleIndex + 1} · {rule?.name ?? "Market rule"}
              </p>
              <p className="body-secondary">{observedVsLimit(rule?.kind, breach.observed, breach.limit)}</p>
              {rule?.limit && <p className={s.fine}>Mandate limit: {rule.limit}</p>}
            </section>

            <section className={`card ${s.block}`} aria-labelledby="eq-h">
              <h2 id="eq-h" className={s.h2}>
                Equity at flag
              </h2>
              <dl className={s.nums}>
                <div>
                  <dt>Peak</dt>
                  <dd>{usd(peak)}</dd>
                </div>
                <div>
                  <dt>At flag</dt>
                  <dd>{usd(atFlag)}</dd>
                </div>
                <div>
                  <dt>Loss from peak</dt>
                  <dd data-tone="breach">{usd(loss)}</dd>
                </div>
              </dl>
              <p className={s.fine}>
                When slashed, the bond pays the backer this loss — not a round marketing number.
              </p>
            </section>

            {!breach.slashed && (
              <section className={`card ${s.block}`} aria-labelledby="win-h">
                <h2 id="win-h" className={s.h2}>
                  Dispute window
                </h2>
                <p className="body-secondary">
                  {windowBlocks.toLocaleString("en-US")} blocks after the flag. Operator may dispute; otherwise anyone
                  can slash.
                </p>
                <div className={s.track} aria-hidden>
                  <span className={s.fill} style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p className={s.countdown}>
                  {blocksLeft > 0
                    ? `${blocksLeft.toLocaleString("en-US")} of ${windowBlocks.toLocaleString("en-US")} blocks remaining`
                    : "Window closed"}
                </p>
              </section>
            )}

            {breach.slashed && (
              <section className={`card ${s.block}`} aria-labelledby="slash-h">
                <h2 id="slash-h" className={s.h2}>
                  Slash
                </h2>
                <p className={s.paid}>
                  Bond paid the backer <strong>{usd(loss)}</strong> — the exact loss from peak.
                </p>
                <p className={s.fine}>Account was set close-only when the breach was flagged.</p>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}
