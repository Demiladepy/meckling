"use client";

import { useEffect, useState } from "react";
import s from "./HeroFilm.module.css";

/**
 * The landing page's explainer: four scenes that loop like a short film, drawn in the product's own components so it
 * stays sharp at any size. It illustrates what happens on-chain; the numbers come from real runs on Monad testnet.
 * Replace with the recorded video once it exists.
 */
const SCENES = [
  { title: "An AI agent proposes a trade.", ms: 4600 },
  { title: "Monad checks every rule, inside the trade.", ms: 5200 },
  { title: "A trade that breaks a rule never happens.", ms: 5600 },
  { title: "If the market breaks a rule, the bond pays you back.", ms: 6200 },
];

export function HeroFilm() {
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);

  // Respect reduced motion: start paused, and let the viewer step through.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setScene((i) => (i + 1) % SCENES.length), SCENES[scene]!.ms);
    return () => clearTimeout(id);
  }, [scene, playing]);

  return (
    <div className={s.film} data-playing={playing || undefined}>
      <div className={s.bar}>
        <span className={s.dots} aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span className={s.barTitle}>How Meckling works</span>
        <button type="button" className={s.toggle} onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>

      <div className={s.progress} role="tablist" aria-label="Scenes">
        {SCENES.map((sc, i) => (
          <button
            key={sc.title}
            type="button"
            role="tab"
            aria-selected={i === scene}
            aria-label={`Scene ${i + 1}: ${sc.title}`}
            className={s.segment}
            data-state={i < scene ? "done" : i === scene ? "now" : "next"}
            onClick={() => setScene(i)}
            style={{ ["--d" as string]: `${sc.ms}ms` }}
          >
            <span key={`${i}-${scene}-${playing}`} />
          </button>
        ))}
      </div>

      <div className={s.stage} key={scene}>
        {scene === 0 && <Propose />}
        {scene === 1 && <Check />}
        {scene === 2 && <Verdict />}
        {scene === 3 && <Breach />}
      </div>

      <p className={s.subtitle} aria-live="polite">
        <span className={s.step}>{scene + 1}</span>
        {SCENES[scene]!.title}
      </p>
    </div>
  );
}

function Propose() {
  return (
    <div className={s.propose}>
      <div className={s.agent}>
        <span className={s.avatar}>AI</span>
        <div>
          <p className={s.who}>Trading agent</p>
          <p className={s.quote}>
            &ldquo;Smart money is 77% net short BTC and the regime is risk-off. Going short, 12&times;.&rdquo;
          </p>
        </div>
      </div>
      <div className={s.order}>
        <span className={s.label}>Proposed order</span>
        <span className={s.big}>BTC short</span>
        <span className={s.lev}>12&times; leverage</span>
      </div>
    </div>
  );
}

const RULES = [
  ["Allowed markets", "BTC, ETH"],
  ["Position size", "under $160"],
  ["Order rate", "1 of 10"],
  ["Cooldown after a loss", "ready"],
  ["Price protection", "within 1%"],
  ["Max leverage", "12× of 1.5×"],
] as const;

function Check() {
  return (
    <ul className={s.rules}>
      {RULES.map(([name, value], i) => {
        const fails = i === RULES.length - 1;
        return (
          <li key={name} style={{ ["--i" as string]: i }} data-fails={fails || undefined}>
            <span className={s.ruleName}>{name}</span>
            <span className={s.ruleValue}>{value}</span>
            <span className={s.ruleMark} aria-hidden>
              {fails ? "✕" : "✓"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Verdict() {
  return (
    <div className={s.verdicts}>
      <div className={s.blocked}>
        <span className={s.badgeBreach}>Blocked on-chain</span>
        <p className={s.verdictBig}>12.0&times;</p>
        <p className={s.verdictSub}>against a 1.5&times; limit. Nothing reached the exchange.</p>
      </div>
      <div className={s.filled}>
        <span className={s.badgeHeld}>Filled on Perpl</span>
        <p className={s.verdictMid}>Retried at 0.7&times;</p>
        <p className={s.verdictSub}>$143.47 notional. Every rule held.</p>
      </div>
    </div>
  );
}

function Breach() {
  return (
    <div className={s.breach}>
      <svg className={s.chart} viewBox="0 0 400 130" aria-hidden>
        <line x1="0" y1="88" x2="400" y2="88" className={s.floor} />
        <text x="398" y="80" textAnchor="end" className={s.floorText}>
          Drawdown floor
        </text>
        <path
          className={s.line}
          pathLength={1}
          d="M2 30 L60 24 L110 36 L160 20 L210 34 L250 52 L290 80 L330 104 L370 116 L398 112"
        />
        <circle cx="303" cy="88" r="5" className={s.cross} />
      </svg>
      <ol className={s.events}>
        <li style={{ ["--i" as string]: 0 }}>Breach flagged and re-checked against Chainlink prices</li>
        <li style={{ ["--i" as string]: 1 }}>Position closed, account locked to closing only</li>
        <li style={{ ["--i" as string]: 2 }} className={s.paid}>
          Bond paid the backer 0.989276 AUSD, the exact loss
        </li>
      </ol>
    </div>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <rect x="3" y="2" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="8" y="2" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M4 2.5v9l7.5-4.5z" fill="currentColor" />
    </svg>
  );
}
