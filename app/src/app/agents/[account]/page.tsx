"use client";

import { use, useMemo, useState } from "react";
import { memoryKeyMessage, memoryKeyPair, memorySalt, openRecord } from "@mandate/common";
import { AppHeader } from "@/components/AppHeader";
import { ReportHashVerify } from "@/components/ReportHashVerify";
import { formatBlock, shortAddr, useConfig, usePoll, usd } from "@/lib/client";
import { headroom, observedVsLimit, type AccountView, type BreachView, type HistoryView, type LogRecordView, type RuleView } from "@/lib/view";
import { bytesToHex, type Address, type Hex } from "viem";
import { useMera } from "@/lib/mera";
import { errorText } from "@/lib/tx";
import s from "./page.module.css";

const SIDE: Record<string, string> = { long: "long", short: "short", close: "close" };

export default function AgentSplitScreen({ params }: { params: Promise<{ account: string }> }) {
  const { account } = use(params);
  const cfg = useConfig();
  // 2 s keeps the demo feeling live while staying inside public-RPC limits (the API caches on top of this).
  const view = usePoll<AccountView>(`/api/accounts/${account}`, 2000);
  const log = usePoll<{ records: LogRecordView[] }>(`/api/accounts/${account}/log`, 2000);
  // Track record comes from the Envio indexer: Monad full nodes serve no history. Absent one, the strip hides itself.
  const history = usePoll<HistoryView>(`/api/accounts/${account}/history`, 10000);
  const track = history?.indexer ? history.trackRecord : undefined;
  const records = log?.records ?? [];

  // Private reasoning (D13): sealed to the backer's passkey. Decrypted text lives only in this tab's memory.
  const mera = useMera();
  const memory = usePoll<{ available: boolean; publicKey: string | null }>(`/api/accounts/${account}/memory-key`, 30000);
  const [opened, setOpened] = useState<Record<string, string>>({});
  const [memoryNote, setMemoryNote] = useState<string>();
  const [memoryBusy, setMemoryBusy] = useState(false);
  const sealedCount = records.filter((r) => r.sealed).length;
  const isBacker = Boolean(
    mera.account && view?.mandate?.backer && mera.account.address.toLowerCase() === view.mandate.backer.toLowerCase(),
  );

  async function memoryKeys() {
    return memoryKeyPair(await mera.prfFor(memorySalt(account as Address)));
  }

  async function makePrivate() {
    setMemoryBusy(true);
    setMemoryNote(undefined);
    try {
      const signer = mera.account ?? (await mera.signIn());
      if (!signer) return;
      const publicKey = bytesToHex((await memoryKeys()).publicKey);
      const signature = await signer.signMessage({ message: memoryKeyMessage(account as Address, publicKey) });
      const res = await fetch(`/api/accounts/${account}/memory-key`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicKey, signature }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Couldn't make the reasoning private.");
      setMemoryNote("Private. From the agent's next decision, only your passkey can read its reasoning.");
    } catch (e) {
      setMemoryNote(errorText(e));
    } finally {
      setMemoryBusy(false);
    }
  }

  async function unlock() {
    setMemoryBusy(true);
    setMemoryNote(undefined);
    try {
      const { secretKey } = await memoryKeys();
      const next: Record<string, string> = {};
      for (const r of records) {
        if (!r.sealed) continue;
        try {
          next[recordKey(r)] = openRecord(secretKey, r.sealed);
        } catch {
          // Not this passkey's record: left sealed.
        }
      }
      setOpened(next);
      if (!Object.keys(next).length) setMemoryNote("This passkey can't open this agent's reasoning. Only the backer's can.");
    } catch (e) {
      setMemoryNote(errorText(e));
    } finally {
      setMemoryBusy(false);
    }
  }

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
              {track && (
                <>
                  <div>
                    <dt>Max drawdown</dt>
                    <dd>{(track.maxDrawdownBps / 100).toFixed(2)}%</dd>
                  </div>
                  <div>
                    <dt>Trades blocked</dt>
                    <dd>{track.violationsAttempted}</dd>
                  </div>
                </>
              )}
            </dl>
          )}
        </header>

        {view?.mandate?.reportHash && view.mandate.reportHash !== `0x${"0".repeat(64)}` && (
          <ReportHashVerify
            compact
            expectedHash={view.mandate.reportHash as Hex}
            onChainHash={view.mandate.reportHash as Hex}
          />
        )}

        {memory?.available && (memory.publicKey || isBacker) && (
          <section className={`card ${s.memory}`} aria-label="Private reasoning">
            <div>
              <p className={s.memoryHead}>
                {memory.publicKey ? "Private reasoning" : "Make this agent's reasoning private"}
              </p>
              <p className="body-secondary">
                {memory.publicKey
                  ? "The agent seals its reasoning to the backer's passkey. Nobody else — not the operator's viewers, not us — can read it, on any device."
                  : "Its reasoning reveals the strategy and your positions. Seal it to your passkey: only you will be able to read it, on any device."}
              </p>
              {memoryNote && <p className={s.memoryNote}>{memoryNote}</p>}
            </div>
            {memory.publicKey ? (
              sealedCount > 0 && (
                <button type="button" className="button-ghost" onClick={() => void unlock()} disabled={memoryBusy}>
                  {memoryBusy ? "Waiting for passkey…" : `Unlock ${sealedCount} with passkey`}
                </button>
              )
            ) : (
              <button type="button" className="button-primary" onClick={() => void makePrivate()} disabled={memoryBusy}>
                {memoryBusy ? "Waiting for passkey…" : "Make reasoning private"}
              </button>
            )}
          </section>
        )}

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
            <Row
              key={`${r.ts}-${i}`}
              r={r}
              view={view}
              marketName={marketName}
              first={i === 0}
              last={i === records.length - 1 && !view?.breaches.length}
              opened={opened[recordKey(r)]}
            />
          ))}
          {view?.breaches.map((b, i) => (
            <BreachRow key={b.id} account={account} b={b} rule={view.rules[b.ruleIndex]} last={i === view.breaches.length - 1} />
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

/**
 * A market rule the market broke, not the agent: the keeper flagged it, BondVault verified it, and the account
 * unwound. Nothing the agent did appears on the left, which is the point.
 */
function BreachRow({ account, b, rule, last }: { account: string; b: BreachView; rule?: RuleView; last: boolean }) {
  const loss = Number(b.loss) / 1e6;
  return (
    <div className={s.row} data-last={last || undefined}>
      <div className={s.agent}>
        <p className={s.block}>
          Block <span className="onchain">{formatBlock(b.flaggedAtBlock)}</span>
        </p>
        <p className="body-secondary">The market moved. The agent did nothing.</p>
      </div>
      <div className={s.chain}>
        <div className={s.verdict} data-result="breach">
          <p className={s.blockDark}>
            Block <span className="onchain">{formatBlock(b.flaggedAtBlock)}</span>
          </p>
          <p className={s.headline} data-tone="breach">
            Breach flagged on-chain
          </p>
          <p>
            Rule {b.ruleIndex + 1} · {rule?.name ?? "Max drawdown"}
          </p>
          <p>{observedVsLimit(rule?.kind, b.observed, b.limit)}</p>
          <p className={s.quiet}>Position unwound. The account is close-only.</p>
          {b.slashed ? (
            <p className={s.headline} data-tone="held">
              Bond paid the backer {usd(loss)}
            </p>
          ) : (
            <p className={s.pending}>{b.disputed ? "Disputed, waiting on the arbiter." : "Dispute window open."}</p>
          )}
          <p className={s.quiet}>
            <a href={`/breaches/${account}/${b.id}`}>Open breach detail</a>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Identifies a record across polls, so an unlocked note stays unlocked as new records arrive. */
const recordKey = (r: LogRecordView) => `${r.block}:${r.ts}`;

function Row({
  r,
  view,
  marketName,
  first,
  last,
  opened,
}: {
  r: LogRecordView;
  view?: AccountView;
  marketName: (id: number) => string;
  first: boolean;
  last: boolean;
  /** This record's reasoning, decrypted in the browser with the backer's passkey. */
  opened?: string;
}) {
  const rule = r.violation ? view?.rules[r.violation.ruleIndex] : undefined;
  const block = r.resultBlock ?? r.block;
  return (
    <div className={s.row} data-first={first || undefined} data-last={last || undefined}>
      <div className={s.agent}>
        <p className={s.block}>
          Block <span className="onchain">{formatBlock(r.block)}</span>
          {/* Honesty rule: a scripted run says it is scripted, right where the reasoning appears. */}
          {r.provider === "scripted-demo" && (
            <span className="badge" data-tone="pending" style={{ marginLeft: 10 }}>
              Scripted demo
            </span>
          )}
        </p>
        {r.sealed && opened === undefined ? (
          <p className={s.sealed}>Private — only the backer can read this reasoning.</p>
        ) : (
          <p className={s.reasoning}>&ldquo;{opened ?? r.reasoning}&rdquo;</p>
        )}
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
                Blocked on-chain
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
