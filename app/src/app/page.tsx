import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import s from "./page.module.css";

/**
 * The live agent on the current testnet contracts: Nansen mandate #1. Everything the hero and the step images show
 * is read from this account — its reasoning log, the 12x block, the fill and the breach the bond paid.
 */
const LIVE_AGENT = "0xAdb15A72D8e01FC641ad2E218E060e434f2610e0";
const BREACH_AGENT = LIVE_AGENT;

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <section className={s.hero} aria-labelledby="hero-h">
          <div className={s.heroCopy}>
            <h1 id="hero-h" className="display">
              AI traders that can&rsquo;t break your rules.
            </h1>
            <div className={s.heroSide}>
              <p className={s.lede}>
                Nansen&rsquo;s smart-money data sets the limits. Monad checks them inside every trade. If the market breaks
                one anyway, the operator&rsquo;s bond pays you back.
              </p>
              <div className={s.ctas}>
                <Link className="button-primary" href="/mandates/new">
                  Back an agent
                </Link>
                <Link className="button-ghost" href={`/agents/${LIVE_AGENT}`}>
                  Watch one live
                </Link>
              </div>
            </div>
          </div>

          <figure className={s.showcase}>
            <div className={s.glow} aria-hidden />
            <AgentWindow />
            <figcaption className={s.caption}>
              The live agent on Monad testnet, shown as it happened. This run used the scripted demo agent: it quotes
              the real Nansen report and deliberately tries 12× to test the limits. The block and the fill are real
              on-chain transactions.
            </figcaption>
          </figure>
        </section>

        <section className={s.ledger} aria-label="Measured on Monad testnet">
          <Stat value="12.0×" label="Attempted leverage, stopped against a 1.5× limit set from Nansen data" />
          <Stat value="6 blocks" label="From a market breach to an on-chain flag, about two seconds" />
          <Stat value="$0.109218" label="Paid to the backer from the operator’s bond, the exact loss" />
          <Stat value="16,000" label="Randomised attacks on the contracts, and every safety rule held" />
        </section>

        <section className={s.steps} aria-labelledby="how-h">
          <h2 id="how-h" className="section-heading">
            From evidence to enforcement.
          </h2>

          <article className={s.step}>
            <div className={s.stepCopy}>
              <p className={s.stepIndex}>Step 1</p>
              <h3 className={s.stepTitle}>Nansen sets the limits.</h3>
              <p className={s.stepBody}>
                Pick the markets. Mandate reads smart-money flows and positioning from Nansen and turns them into hard
                numbers: leverage, position size, a cooldown after losses, a drawdown floor. Every limit shows the signal
                behind it.
              </p>
            </div>
            <UnderwritingFragment />
          </article>

          <article className={s.step}>
            <div className={s.stepCopy}>
              <p className={s.stepIndex}>Step 2</p>
              <h3 className={s.stepTitle}>Every trade is checked before it lands.</h3>
              <p className={s.stepBody}>
                The agent trades through an account that tests each order against your limits in the same transaction. A
                trade that breaks one never happens. There is no alert to miss and no one to trust.
              </p>
            </div>
            <VerdictFragment />
          </article>

          <article className={s.step}>
            <div className={s.stepCopy}>
              <p className={s.stepIndex}>Step 3</p>
              <h3 className={s.stepTitle}>When the market breaks a rule, the bond pays.</h3>
              <p className={s.stepBody}>
                Some limits can be broken by price alone. A keeper watches every account; when one slips past its
                drawdown floor, the position is closed and the operator&rsquo;s bond covers the loss.
              </p>
              <Link className={s.inline} href={`/agents/${BREACH_AGENT}`}>
                See the breach that paid out
              </Link>
            </div>
            <BreachFragment />
          </article>
        </section>

        <section className={s.parts} aria-labelledby="parts-h">
          <h2 id="parts-h" className="section-heading">
            Who does what.
          </h2>
          <div className={s.partGrid}>
            <div className={s.part}>
              <h3>Nansen</h3>
              <p>
                Supplies the evidence. Its report is fingerprinted and stored with the mandate, so anyone can check the
                limits came from it.
              </p>
            </div>
            <div className={s.part}>
              <h3>The agent</h3>
              <p>
                Reads the market and proposes trades. It never sets its own limits and can never withdraw your money.
              </p>
            </div>
            <div className={s.part}>
              <h3>Monad</h3>
              <p>
                Decides. Every trade is checked on-chain, and every breach is settled from the bond in AUSD.
              </p>
            </div>
          </div>
        </section>

        <section className={s.close} aria-labelledby="close-h">
          <div className={s.closeGlow} aria-hidden />
          <h2 id="close-h" className="section-heading">
            Limits you can check. Losses that get paid.
          </h2>
          <div className={s.ctas}>
            <Link className="button-primary" href="/mandates/new">
              Back an agent
            </Link>
            <Link className="button-ghost" href="/trade">
              Trade under your own rules
            </Link>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={s.footerInner}>
          <span className={s.footerBrand}>Mandate</span>
          <nav className={s.footerNav} aria-label="Footer">
            <Link href="/agents">Agents</Link>
            <Link href="/mandates/new">Back an agent</Link>
            <Link href="/trade">Trade</Link>
          </nav>
          <p className={s.footerNote}>Running on Monad testnet with test AUSD.</p>
        </div>
      </footer>
    </>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className={s.stat}>
      <p className={s.statValue}>{value}</p>
      <p className={s.statLabel}>{label}</p>
    </div>
  );
}

/**
 * The hero image: the agent screen itself, drawn in the product's own components rather than a screenshot, so it is
 * sharp at any size. Decorative for screen readers; the caption carries the meaning.
 */
function AgentWindow() {
  return (
    <div className={s.window} aria-hidden>
      <div className={s.windowBar}>
        <span className={s.windowTitle}>
          Agent <span className="onchain">0xAdb1…10e0</span>
        </span>
        <span className="badge" data-tone="held">
          <span className={s.liveDot} /> Live on Monad
        </span>
        <span className={s.windowEquity}>
          Equity <strong>$200.01</strong>
        </span>
      </div>

      <div className={s.columns}>
        <span className={s.colLabel}>Agent</span>
        <span className={s.colLabel}>Chain</span>
      </div>

      <div className={s.row}>
        <div className={s.agentCell}>
          <p className={s.quote}>
            &ldquo;Smart money on Hyperliquid is net short BTC: 66% skew across 100 traders at 14.2x average leverage.
            (from the underwriting report of 2026-09-23) Going 12x short.&rdquo;
          </p>
          <p className={s.proposal}>Proposed: BTC short, 12.0×</p>
        </div>
        <div className={s.chainCell} data-tone="breach">
          <span className="badge" data-tone="breach">
            Blocked on-chain
          </span>
          <p className={s.verdict}>This trade would put you at 12.0× leverage. Your limit is 1.5×.</p>
          <div className={s.meter}>
            <span className={s.meterFill} style={{ width: "100%" }} data-tone="breach" />
            <span className={s.meterMark} style={{ left: "12.5%" }} />
          </div>
          <p className={s.quiet}>Nothing changed. The order never reached the exchange.</p>
        </div>
      </div>

      <div className={s.row}>
        <div className={s.agentCell}>
          <p className={s.quote}>&ldquo;Limit is 1.5x and $160 on BTC. Going 0.7x short.&rdquo;</p>
          <p className={s.proposal}>Proposed: BTC short, 0.7×</p>
        </div>
        <div className={s.chainCell} data-tone="held">
          <span className="badge" data-tone="held">
            Filled on Perpl
          </span>
          <p className={s.verdict}>$143.47 notional. Every rule held.</p>
        </div>
      </div>

      <div className={s.headroom}>
        <Headroom label="Leverage" used={0.47} text="0.7 of 1.5×" />
        <Headroom label="BTC size" used={0.897} text="$143 of $160" />
        <Headroom label="Orders" used={0.1} text="1 of 10 in window" />
      </div>
    </div>
  );
}

function Headroom({ label, used, text }: { label: string; used: number; text: string }) {
  return (
    <div className={s.hr}>
      <span className={s.hrLabel}>{label}</span>
      <span className={s.hrTrack}>
        <span className={s.hrFill} style={{ width: `${used * 100}%` }} />
      </span>
      <span className={s.hrText}>{text}</span>
    </div>
  );
}

/** Step 1 image: the limits the live agent's mandate carries on-chain, and its real report fingerprint. */
function UnderwritingFragment() {
  const rows = [
    ["Max leverage", "1.5×"],
    ["BTC position", "$160"],
    ["Markets", "BTC only"],
    ["Order rate", "10 per 100 blocks"],
    ["Cooldown after an $8 loss", "600 blocks"],
  ];
  return (
    <div className={`${s.fragment} ${s.frost}`} aria-hidden>
      <div className={s.fragHead}>
        <span>Underwriting report</span>
        <span className="badge" data-tone="pending">
          Set from live Nansen data
        </span>
      </div>
      <ul className={s.limits}>
        {rows.map(([k, v]) => (
          <li key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </li>
        ))}
      </ul>
      <div className={s.fingerprint}>
        <span>Report fingerprint</span>
        <span className="onchain">0x0882f77c…9a66</span>
        <span className="badge" data-tone="held">
          Matches on-chain
        </span>
      </div>
    </div>
  );
}

/** Step 2 image: the verdict, big. */
function VerdictFragment() {
  return (
    <div className={`${s.fragment} ${s.ember}`} aria-hidden>
      <span className="badge" data-tone="breach">
        Blocked on-chain
      </span>
      <p className={s.bigVerdict}>12.0×</p>
      <p className={s.verdictSub}>Attempted leverage. The limit is 1.5×.</p>
      <div className={s.compare}>
        <div>
          <span className={s.compareLabel}>Limit</span>
          <span className={s.compareBar} style={{ width: "12.5%" }} data-tone="held" />
        </div>
        <div>
          <span className={s.compareLabel}>Attempted</span>
          <span className={s.compareBar} style={{ width: "100%" }} data-tone="breach" />
        </div>
      </div>
    </div>
  );
}

/** Step 3 image: the breach as it actually happened on testnet. */
function BreachFragment() {
  const events = [
    { t: "Block 64,986,214", h: "Breach flagged", d: "Drawdown past the floor. Caught 6 blocks after it happened." },
    { t: "Same transaction", h: "Position closed", d: "The account can only close trades from here on." },
    { t: "200 blocks later", h: "Dispute window ends", d: "No one disputed the breach." },
    { t: "Settled", h: "Bond paid $0.109218", d: "The exact loss from the equity peak, in AUSD." },
  ];
  return (
    <div className={`${s.fragment} ${s.ember}`} aria-hidden>
      <ol className={s.timeline}>
        {events.map((e, i) => (
          <li key={e.h} data-last={i === events.length - 1 || undefined}>
            <span className={s.tTime}>{e.t}</span>
            <span className={s.tHead}>{e.h}</span>
            <span className={s.tBody}>{e.d}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
