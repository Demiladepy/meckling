// Spike S6 verification: calls each confirmed endpoint once against the owner's key and prints
// status, row count and credit cost. Run: pnpm --filter underwriter smoke
import { NansenClient, NansenError } from "./nansen.ts";

const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A"; // WMON on Monad mainnet (verified: symbol() == "WMON"; underlying of Curvance cWMON)

const client = new NansenClient(process.env.NANSEN_API_KEY ?? "");
const page = { page: 1, per_page: 5 };

const checks: [string, () => Promise<{ data: unknown[]; creditsCost?: number }>][] = [
  ["smart-money/netflow (monad)", () => client.smartMoneyNetflow({ chains: ["monad"], pagination: page })],
  [
    "tgm/holders (WMON, smart_money)",
    () => client.tokenHolders({ chain: "monad", token_address: WMON, label_type: "smart_money", pagination: page }),
  ],
  ["tgm/perp-positions (BTC, smart_money)", () => client.perpPositions({ token_symbol: "BTC", label_type: "smart_money", pagination: page })],
  [
    "smart-money/pnl-leaderboard (monad, 7d)",
    () => client.smartMoneyPnlLeaderboard({ chains: ["monad"], timeframe: 7, pagination: page }),
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  try {
    const res = await run();
    console.log(`ok    ${name}: ${res.data.length} rows, credits ${res.creditsCost ?? "n/a"}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${name}: ${err instanceof NansenError ? `${err.status} ${err.body.slice(0, 200)}` : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
