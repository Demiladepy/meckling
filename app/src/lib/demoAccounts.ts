/**
 * Curated Monad testnet accounts for the agents list and judge demo.
 * Live numbers come from `/api/accounts/[account]`; these rows only name them.
 * Sources: docs/handoff.md, docs/plan.md (breach account).
 */
export interface DemoAgent {
  address: `0x${string}`;
  label: string;
  blurb: string;
  /** Shown when live data is still loading. */
  limits: string;
  nansen: boolean;
}

export const DEMO_AGENTS: DemoAgent[] = [
  {
    address: "0xAdb15A72D8e01FC641ad2E218E060e434f2610e0",
    label: "Nansen-backed agent",
    blurb: "Limits set from live Nansen data. When the market broke its drawdown floor, the breach was flagged in 6 blocks and the bond paid the backer $0.109218.",
    limits: "Drawdown floor breached, now close-only",
    nansen: true,
  },
  {
    address: "0xB81b1d54a76170dD0c5c4306f5f0437329afA53F",
    label: "Self-mandate trader",
    blurb: "A trader holding themselves to their own rules. A $50 long filled; a $220 long was blocked by their own size limit.",
    limits: "BTC only, 3× leverage, $250 per market",
    nansen: false,
  },
];
