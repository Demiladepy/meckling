"use client";

import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { DEMO_AGENTS } from "@/lib/demoAccounts";
import { shortAddr, usd, usePoll } from "@/lib/client";
import type { AccountView, HistoryView } from "@/lib/view";
import s from "./page.module.css";

export default function AgentsList() {
  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <header className={s.intro}>
          <p className={s.kicker}>Monad testnet · live accounts</p>
          <h1 className="section-heading">Agents</h1>
          <p className="body-secondary">
            MandateAccounts enforcing limits from live Nansen underwriting — and the breach path that paid a backer
            the exact loss from peak. Open one to watch paper proposals meet ink verdicts.
          </p>
        </header>

        <ul className={s.list}>
          {DEMO_AGENTS.map((a) => (
            <AgentCard key={a.address} agent={a} />
          ))}
        </ul>

        <aside className={`card ${s.aside}`}>
          <h2 className={s.asideTitle}>Underwrite a new account</h2>
          <p>
            Pull live Nansen evidence, approve limits with a passkey, and fund on Perpl. The report hash is verifiable
            against MandateRegistry.
          </p>
          <Link className="button-primary" href="/mandates/new">
            Create mandate
          </Link>
        </aside>
      </main>
    </>
  );
}

function AgentCard({ agent }: { agent: (typeof DEMO_AGENTS)[number] }) {
  const view = usePoll<AccountView>(`/api/accounts/${agent.address}`, 5000);
  const history = usePoll<HistoryView>(`/api/accounts/${agent.address}/history`, 15000);
  const track = history?.indexer ? history.trackRecord : undefined;
  const equity = view ? Number(view.state.equity) / 1e6 : undefined;
  const bond = view?.bond ? Number(view.bond.amount) / 1e6 : undefined;
  const breaches = view?.breaches.length ?? 0;
  const status = view?.closeOnly ? "Close-only" : view?.mandate ? "Active mandate" : "Loading…";

  return (
    <li>
      <Link href={`/agents/${agent.address}`} className={`card ${s.card}`}>
        <div className={s.cardTop}>
          <div>
            <h2 className={s.title}>{agent.label}</h2>
            <p className={`onchain ${s.addr}`}>{agent.address}</p>
          </div>
          <div className={s.badges}>
            {agent.nansen ? <span className="badge">Nansen</span> : <span className={`badge ${s.self}`}>Self</span>}
            <span className={s.status}>{status}</span>
          </div>
        </div>
        <p className={s.blurb}>{agent.blurb}</p>
        <dl className={s.stats}>
          <div>
            <dt>Equity</dt>
            <dd>{equity === undefined ? "…" : usd(equity)}</dd>
          </div>
          <div>
            <dt>Bond</dt>
            <dd>{bond === undefined || bond === 0 ? "—" : usd(bond)}</dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>{track ? track.violationsAttempted : "—"}</dd>
          </div>
          <div>
            <dt>Breaches</dt>
            <dd>{breaches}</dd>
          </div>
        </dl>
        <p className={s.limits}>{agent.limits}</p>
        {view?.mandate?.reportHash && view.mandate.reportHash !== `0x${"0".repeat(64)}` && (
          <p className={s.hash}>
            reportHash <span className="onchain">{shortAddr(view.mandate.reportHash)}</span>
          </p>
        )}
      </Link>
    </li>
  );
}
