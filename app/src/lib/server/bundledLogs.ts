import "server-only";
import adb15 from "./agent-logs/0xadb15a72d8e01fc641ad2e218e060e434f2610e0.json";
import b70a5 from "./agent-logs/0xb70a5c4a6af38acc1a69baf34224ed22e8b964c3.json";

/**
 * Agent logs shipped with the app for the testnet agents the landing page links to (until the site reads them from Upstash).
 *
 * The agent writes its log to data/ on the machine it runs on, which is not in git and not on Vercel. Without this,
 * the public site's agent screen would be empty. These are the agent's real records, copied unchanged.
 */
const BUNDLED: Record<string, unknown[]> = {
  "0xadb15a72d8e01fc641ad2e218e060e434f2610e0": adb15,
  "0xb70a5c4a6af38acc1a69baf34224ed22e8b964c3": b70a5,
};

export function bundledLog(account: string): unknown[] | undefined {
  return BUNDLED[account.toLowerCase()];
}
