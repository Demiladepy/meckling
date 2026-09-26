import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import s from "./page.module.css";

/** Live Nansen-backed MandateAccount on Monad testnet — docs/handoff.md */
const LIVE_AGENT = "0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A";
const BREACH_AGENT = "0xAdb15A72D8e01FC641ad2E218E060e434f2610e0";

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <section className={s.hero} aria-labelledby="brand">
          <p className={s.kicker}>Powered by Nansen · Enforced on Monad</p>
          <h1 id="brand" className={`display ${s.brand}`}>
            Mandate
          </h1>
          <p className={s.thesis}>
            Nansen evidence doesn&rsquo;t inform a human dashboard here — it is compiled into limits a smart
            contract enforces, and the report that justified them is hashed on-chain with the mandate.
          </p>
          <div className={s.ctas}>
            <Link className="button-primary" href="/mandates/new">
              Underwrite with Nansen
            </Link>
            <Link className="button-ghost" href={`/agents/${LIVE_AGENT}`}>
              See enforcement live
            </Link>
          </div>
        </section>

        <section className={s.proof} aria-label="Proven on Monad testnet">
          <div className={s.proofItem}>
            <p className={s.proofValue}>11.3×</p>
            <p className={s.proofLabel}>Observed leverage blocked against a 1.5× Nansen limit</p>
          </div>
          <div className={s.proofItem}>
            <p className={s.proofValue}>6 blocks</p>
            <p className={s.proofLabel}>Market breach to on-chain flag (~2 s on Monad)</p>
          </div>
          <div className={s.proofItem}>
            <p className={s.proofValue}>$0.109218</p>
            <p className={s.proofLabel}>Bond paid the backer — exact loss from peak</p>
          </div>
          <div className={s.proofItem}>
            <p className={s.proofValue}>16k</p>
            <p className={s.proofLabel}>Fuzzed calls · eight PRD invariants held</p>
          </div>
        </section>

        <section className={s.chain} aria-labelledby="chain-h">
          <div className={s.chainCopy}>
            <h2 id="chain-h" className="section-heading">
              Evidence → limit → hash → enforcement
            </h2>
            <p className="body-secondary">
              Smart-money flows and perp positioning set a regime per market. A published table maps that regime to
              leverage, notional, cooldown and drawdown. The full report is stored; its keccak256 is written into
              MandateRegistry. Every trade runs through MandateAccount.execute — a broken action rule reverts in the
              same transaction.
            </p>
          </div>
          <ol className={s.pipeline}>
            <li>
              <span className={s.pipeNum}>01</span>
              <div>
                <h3>Nansen signals</h3>
                <p>Perp skew, 7-day smart-money netflow, holder concentration</p>
              </div>
            </li>
            <li>
              <span className={s.pipeNum}>02</span>
              <div>
                <h3>Proposed limits</h3>
                <p>Each row names the signal that produced the dollar or leverage cap</p>
              </div>
            </li>
            <li>
              <span className={s.pipeNum}>03</span>
              <div>
                <h3>reportHash on-chain</h3>
                <p>Recompute keccak256 in the browser and match MandateRegistry</p>
              </div>
            </li>
            <li>
              <span className={s.pipeNum}>04</span>
              <div>
                <h3>Chain verdict</h3>
                <p>Fill, revert, or market breach paid from the operator bond</p>
              </div>
            </li>
          </ol>
        </section>

        <section className={s.splitPreview} aria-labelledby="split-h">
          <div className={s.splitHead}>
            <h2 id="split-h" className="section-heading">
              Agent proposes. Chain decides.
            </h2>
            <p className="body-secondary">
              Paper is the human side. Ink is whatever the chain already decided — including a live MandateViolation
              against limits sized from Nansen.
            </p>
          </div>

          <Link href={`/agents/${LIVE_AGENT}`} className={s.split} aria-label="Open live agent split screen">
            <div className={s.paper}>
              <span className={s.sideLabel}>Agent</span>
              <p className={s.quote}>
                Open a 12× long on BTC — momentum looks strong and funding is flat.
              </p>
              <span className={s.meta}>Proposed · BTC · high leverage</span>
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
            Live on Monad testnet against a mandate underwritten from Nansen.{" "}
            <Link href={`/agents/${LIVE_AGENT}`}>Open the account</Link>
            {" · "}
            <Link href={`/agents/${BREACH_AGENT}`}>Breach + bond payout</Link>
          </p>
        </section>

        <section className={s.roles} aria-labelledby="roles-h">
          <h2 id="roles-h" className="section-heading">
            What Nansen does — and does not
          </h2>
          <div className={s.roleGrid}>
            <article className={`card ${s.role}`}>
              <h3>Nansen</h3>
              <p>
                Supplies smart-money evidence. Mandate turns that evidence into concrete risk limits and hashes the
                justifying report on-chain.
              </p>
            </article>
            <article className={`card ${s.role}`}>
              <h3>The agent model</h3>
              <p>
                Reasons about the market and proposes trades. It never sets its own limits — those come from the
                mandate, not from the model.
              </p>
            </article>
            <article className={`card-ink ${s.role}`}>
              <h3>The chain</h3>
              <p>
                Enforces every action rule inside execute(). Market breaches are flagged by the keeper; the bond pays
                the backer the exact loss from peak.
              </p>
            </article>
          </div>
        </section>

        <section className={s.ctaBand} aria-labelledby="cta-h">
          <h2 id="cta-h" className="section-heading">
            Run live underwriting
          </h2>
          <p className="body-secondary">
            Pick markets, pull Nansen, approve limits with a passkey, and fund the MandateAccount. The report hash is
            verifiable in-browser against the registry.
          </p>
          <div className={s.ctas}>
            <Link className="button-primary" href="/mandates/new">
              Create a mandate
            </Link>
            <Link className="button-ghost" href="/agents">
              Browse live agents
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
