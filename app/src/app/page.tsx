import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HeroBackdrop } from "@/components/HeroBackdrop";
import { HeroFilm } from "@/components/HeroFilm";
import s from "./page.module.css";

/**
 * The live Claude agent on the current testnet contracts (deployed Oct 7). The hero shows its real run; the 12x block
 * in the stats and Step 2 happened on the first deployment (Sep 23) and stays checkable there (README).
 */
const LIVE_AGENT = "0xB70a5C4A6af38Acc1a69bAf34224ED22e8B964C3";
/** A real drawdown breach on the current contracts: flagged by the keeper, the bond paid the backer 0.989276 AUSD. */
const BREACH_AGENT = "0xc7Eb03EDfafF6062fE756f53e7B021B495fCa30B";

export default function Home() {
  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <section className={s.hero} aria-labelledby="hero-h">
          <div className={s.heroBand}>
            <HeroBackdrop />
          </div>
          <div className={s.heroCopy}>
            <p className={s.eyebrow}>
              <span className={s.liveDot} /> Live on Monad testnet
            </p>
            <h1 id="hero-h" className="display">
              AI traders that can&rsquo;t break your rules.
            </h1>
            <p className={s.lede}>
              Monad checks an AI agent&rsquo;s limits inside every trade it makes. Its key can trade but never withdraw. If
              the market breaks a limit anyway, the operator&rsquo;s bond pays you back.
            </p>
            <div className={s.ctas}>
              <Link className="button-primary" href="/trade">
                Trade under your own rules
              </Link>
              <Link className="button-ghost" href="/mandates/new">
                Back an agent
              </Link>
            </div>
          </div>

          <figure className={s.showcase}>
            <div className={s.glow} aria-hidden />
            <HeroFilm />
            <figcaption className={s.caption}>
              An illustration built from real runs on Monad testnet. Every number in it happened on-chain.
            </figcaption>
          </figure>
        </section>

        <section className={s.ledger} aria-label="Measured on Monad testnet">
          <Stat value="12.0×" label="An agent’s attempted leverage, blocked on-chain against a 1.5× limit" />
          <Stat value="0.989276" label="AUSD paid to a backer from the operator’s bond after a real breach: the exact loss" />
          <Stat value="21,342" label="Gas saved on every checked trade by laying storage out for Monad’s page pricing" />
          <Stat value="8 of 8" label="Rule properties proven for every possible input, not just tested" />
        </section>

        <section className={s.live} aria-labelledby="live-h">
          <div className={s.liveHead}>
            <h2 id="live-h" className="section-heading">
              Live right now.
            </h2>
            <p className={s.liveSub}>
              Claude trading on Perpl under eight on-chain rules set from a Nansen report. Its words and both fills are
              real, shown as they happened.
            </p>
            <Link className={s.inline} href={`/agents/${LIVE_AGENT}`}>
              Open the live agent
            </Link>
          </div>
          <figure className={s.showcase}>
            <div className={s.glowFrost} aria-hidden />
            <AgentWindow />
          </figure>
        </section>

        <section className={s.steps} aria-labelledby="how-h">
          <h2 id="how-h" className="section-heading">
            From evidence to enforcement.
          </h2>

          <article className={s.step}>
            <div className={s.stepCopy}>
              <p className={s.stepIndex}>Step 1</p>
              <h3 className={s.stepTitle}>Set the limits from evidence.</h3>
              <p className={s.stepBody}>
                Back an agent with limits drawn from Nansen smart-money data, or set your own from your phone. The rules
                are written to Monad, and from then on they can only get tighter.
              </p>
            </div>
            <UnderwritingFragment />
          </article>

          <article className={s.step}>
            <div className={s.stepCopy}>
              <p className={s.stepIndex}>Step 2</p>
              <h3 className={s.stepTitle}>Monad checks every trade, inside the trade.</h3>
              <p className={s.stepBody}>
                The agent trades on Perpl through an account that tests each order against every rule in the same
                transaction. A trade that breaks one never happens. The agent&rsquo;s key can&rsquo;t withdraw, so even a
                hijacked agent has nowhere to send the money.
              </p>
            </div>
            <VerdictFragment />
          </article>

          <article className={s.step}>
            <div className={s.stepCopy}>
              <p className={s.stepIndex}>Step 3</p>
              <h3 className={s.stepTitle}>When the market breaks a rule, the bond pays.</h3>
              <p className={s.stepBody}>
                Some limits can be broken by price alone. A keeper or Chainlink&rsquo;s CRE network flags the breach;
                Monad re-checks it against Chainlink prices, closes the position, and the operator&rsquo;s bond pays you
                back in AUSD.
              </p>
              <Link className={s.inline} href={`/agents/${BREACH_AGENT}`}>
                See the breach that paid out
              </Link>
            </div>
            <BreachFragment />
          </article>
        </section>

        <section className={s.parts} aria-labelledby="parts-h">
          <div>
            <h2 id="parts-h" className="section-heading">
              Built on Monad.
            </h2>
            <p className={s.partsSub}>Each part does one job, and you can see each one working.</p>
          </div>
          <div className={`${s.partGrid} ${s.partGrid4}`}>
            {PARTS.map((p) => (
              <div key={p.name} className={s.part}>
                <h3>{p.name}</h3>
                <p>{p.role}</p>
                <Link className={s.inline} href={p.href}>
                  {p.see}
                </Link>
              </div>
            ))}
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
          <span className={s.footerBrand}>Meckling</span>
          <nav className={s.footerNav} aria-label="Footer">
            <Link href="/agents">Agents</Link>
            <Link href="/mandates/new">Back an agent</Link>
            <Link href="/trade">Trade</Link>
            <Link href="/manifesto">Manifesto</Link>
          </nav>
          <p className={s.footerNote}>
            Built for Monad Metropolis 2026 · Running on Monad testnet with test AUSD ·{" "}
            <a href="https://github.com/Demiladepy/mandate">Source</a>
          </p>
        </div>
      </footer>
    </>
  );
}

/** Every integration, in plain words, with the place in the app where it can be seen working. */
const PARTS = [
  {
    name: "Monad",
    role: "Runs every rule inside the agent’s own transaction, before the order reaches the exchange. Storage is laid out for Monad’s per-page pricing.",
    href: `/agents/${LIVE_AGENT}`,
    see: "Watch a checked trade",
  },
  {
    name: "Perpl",
    role: "The on-chain order book. Each account trades on Perpl in its own name, so every order passes through its rules.",
    href: `/risk/${LIVE_AGENT}`,
    see: "See the positions",
  },
  {
    name: "Agora AUSD",
    role: "The dollar every account holds, every limit is counted in, and every bond pays out in. Trade it from your phone.",
    href: "/trade",
    see: "Trade under your own rules",
  },
  {
    name: "Mera",
    role: "Passkey accounts with no seed phrase. The agent’s private reasoning is sealed to the backer’s passkey, so only they can read it.",
    href: `/agents/${LIVE_AGENT}`,
    see: "See the agent screen",
  },
  {
    name: "Chainlink",
    role: "Price feeds guard every breach, and a CRE workflow checks a breach against Perpl’s own data before flagging it.",
    href: `/agents/${BREACH_AGENT}`,
    see: "See a flagged breach",
  },
  {
    name: "Envio",
    role: "Indexes every trade, blocked attempt and breach into track records, which Monad nodes don’t keep.",
    href: `/risk/${LIVE_AGENT}`,
    see: "See the track record",
  },
  {
    name: "Nansen",
    role: "Smart-money evidence behind an agent’s limits. The report is fingerprinted on-chain, so anyone can check where each limit came from.",
    href: "/mandates/new",
    see: "Get limits from Nansen",
  },
  {
    name: "Claude",
    role: "The agent’s reasoning. It reads the evidence and proposes trades; it never sets its own limits.",
    href: `/agents/${LIVE_AGENT}`,
    see: "Read its decisions",
  },
];

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
          Agent <span className="onchain">0xB70a…64C3</span>
        </span>
        <span className="badge" data-tone="held">
          <span className={s.liveDot} /> Live on Monad
        </span>
        <span className={s.windowEquity}>
          Claude · <strong>8 rules</strong>
        </span>
      </div>

      <div className={s.columns}>
        <span className={s.colLabel}>Agent</span>
        <span className={s.colLabel}>Chain</span>
      </div>

      <div className={s.row}>
        <div className={s.agentCell}>
          <p className={s.quote}>
            &ldquo;Nansen shows smart money on Hyperliquid is 77% net short BTC across 100 traders, and the regime is
            risk-off, so I&rsquo;m taking a short. At $100 notional the account is at 0.5x leverage, under the 1.5x
            cap.&rdquo;
          </p>
          <p className={s.proposal}>Proposed: BTC short, 0.5×</p>
        </div>
        <div className={s.chainCell} data-tone="held">
          <span className="badge" data-tone="held">
            Filled on Perpl
          </span>
          <p className={s.verdict}>$99.87 notional. Every rule held.</p>
        </div>
      </div>

      <div className={s.row}>
        <div className={s.agentCell}>
          <p className={s.quote}>
            &ldquo;Smart money is net short ETH (78% skew across 93 traders). An $80 short keeps ETH under the $160 cap
            and total leverage near 0.9x.&rdquo;
          </p>
          <p className={s.proposal}>Proposed: ETH short, 0.9×</p>
        </div>
        <div className={s.chainCell} data-tone="held">
          <span className="badge" data-tone="held">
            Filled on Perpl
          </span>
          <p className={s.verdict}>$78.15 notional. Every rule held.</p>
        </div>
      </div>

      <div className={s.headroom}>
        <Headroom label="Leverage" used={0.89 / 1.5} text="0.89 of 1.5×" />
        <Headroom label="BTC size" used={99.87 / 160} text="$100 of $160" />
        <Headroom label="ETH size" used={78.15 / 160} text="$78 of $160" />
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
    ["Per market", "$160"],
    ["Markets", "BTC, ETH"],
    ["Cooldown after an $8 loss", "600 blocks"],
    ["Price protection", "1% from the market"],
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
        <span className="onchain">0x977e286d…e171</span>
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
    { t: "Block 69,048,617", h: "Breach flagged", d: "A 0.98% drawdown against a 0.01% floor, re-checked on-chain." },
    { t: "Same transaction", h: "Position closed", d: "The account can only close trades from here on." },
    { t: "20 blocks later", h: "Dispute window ends", d: "No one disputed the breach." },
    { t: "Settled", h: "Bond paid 0.989276 AUSD", d: "The exact loss from the equity peak." },
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
