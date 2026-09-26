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
    address: "0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A",
    label: "Nansen-backed agent",
    blurb: "Underwritten from live Nansen · 11.3× blocked at 1.5× · 0.7× filled on Perpl",
    limits: "1.5× · $160 BTC · $280 ETH · 5% drawdown",
    nansen: true,
  },
  {
    address: "0xAdb15A72D8e01FC641ad2E218E060e434f2610e0",
    label: "Breach + bond payout",
    blurb: "Flagged in 6 blocks · bond paid the backer $0.109218 — exact loss from peak",
    limits: "Max drawdown breached · close-only after flag",
    nansen: true,
  },
  {
    address: "0xB81b1d54a76170dD0c5c4306f5f0437329afA53F",
    label: "Self-mandate trader",
    blurb: "Trader-set rules · $50 filled · $220 blocked by their own notional limit",
    limits: "BTC only · 3× · $250 per market",
    nansen: false,
  },
];
