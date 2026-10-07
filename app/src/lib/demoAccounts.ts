/**
 * Curated Monad testnet accounts for the agents list and judge demo.
 * Live numbers come from `/api/accounts/[account]`; these rows only name them.
 * Current contracts (deployed Oct 7). The first deployment's accounts are listed in the README.
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
    address: "0xB70a5C4A6af38Acc1a69bAf34224ED22e8B964C3",
    label: "Claude agent, Nansen-backed",
    blurb: "Claude trades under limits set from live Nansen data, plus 1% price protection and a $50 operator bond. Every order it sent passed every rule on-chain.",
    limits: "1.5× leverage, $160 per market, BTC and ETH",
    nansen: true,
  },
  {
    address: "0xc7Eb03EDfafF6062fE756f53e7B021B495fCa30B",
    label: "Breach, paid",
    blurb: "A BTC long fell 0.98% from its peak, past its drawdown floor. The keeper flagged it on-chain, the account closed out, and the bond paid the backer 0.989276 AUSD, the exact loss.",
    limits: "Drawdown floor breached, now close-only",
    nansen: false,
  },
  {
    address: "0x1FF625a70751984426f7F6680568B3055944AC0c",
    label: "Self-mandate trader",
    blurb: "A trader holding themselves to their own rules. The same four rules as the first deployment's self-mandate account, which filled a $50 long and blocked a $220 one.",
    limits: "BTC only, 3× leverage, $250 per market",
    nansen: false,
  },
];
