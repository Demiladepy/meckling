import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import s from "./page.module.css";

/** Live demo account on Monad testnet — see docs/handoff.md. */
const DEMO_AGENT = "0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A";

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <section className={s.hero} aria-labelledby="brand">
          <p className={s.kicker}>On Monad · Enforced on-chain</p>
          <h1 id="brand" className={`display ${s.brand}`}>
            Mandate
          </h1>
          <p className={s.thesis}>
            Nansen evidence becomes limits a smart contract enforces. The report that justified them is hashed
            on-chain with the mandate.
          </p>
          <div className={s.ctas}>
            <Link className="button-primary" href="/mandates/new">
              Create a mandate
            </Link>
            <Link className="button-ghost" href="/trade">
              Trade under your own rules
            </Link>
          </div>
        </section>

        <section className={s.splitPreview} aria-labelledby="split-h">
          <div className={s.splitHead}>
            <h2 id="split-h" className="section-heading">
              Agent proposes. Chain decides.
            </h2>
            <p className="body-secondary">
              The human side sits on parchment. Anything the chain decided sits on ink.
            </p>
          </div>

          <Link href={`/agents/${DEMO_AGENT}`} className={s.split} aria-label="Open live demo agent split screen">
            <div className={s.paper}>
              <span className={s.sideLabel}>Agent</span>
              <p className={s.quote}>
                Open a 12× long on BTC — momentum looks strong and funding is flat.
              </p>
              <span className={s.meta}>Proposed · BTC · $2,400</span>
            </div>
            <div className={s.ink}>
              <span className={s.sideLabelInk}>Chain</span>
              <p className={s.verdict}>
                Blocked: this trade would put you at 11.3× leverage. Your limit is 1.5×.
              </p>
              <span className={s.metaInk}>MandateViolation · nothing changed on-chain</span>
            </div>
          </Link>

          <p className={s.caption}>
            Live testnet demo — a real 12× order reverted against a Nansen-sized 1.5× limit.{" "}
            <Link href={`/agents/${DEMO_AGENT}`}>Watch the agent</Link>
          </p>
        </section>

        <section className={s.steps} aria-labelledby="how-h">
          <h2 id="how-h" className="section-heading">
            How it works
          </h2>
          <ol className={s.stepList}>
            <li>
              <span className={s.stepNum}>01</span>
              <div>
                <h3>Underwrite</h3>
                <p className="body-secondary">
                  Smart-money flows and positioning set a regime per market. Each limit names the Nansen signal
                  that produced it.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stepNum}>02</span>
              <div>
                <h3>Approve</h3>
                <p className="body-secondary">
                  The report&rsquo;s keccak256 lands in MandateRegistry with the rules. Anyone can recompute the
                  hash and check it.
                </p>
              </div>
            </li>
            <li>
              <span className={s.stepNum}>03</span>
              <div>
                <h3>Enforce</h3>
                <p className="body-secondary">
                  Every trade runs through MandateAccount.execute. A broken action rule reverts in the same
                  transaction. Market breaches pay from the operator bond.
                </p>
              </div>
            </li>
          </ol>
        </section>
      </main>
    </>
  );
}
