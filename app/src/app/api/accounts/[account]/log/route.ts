import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isAddress } from "viem";
import { DATA_DIR } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";
import { bundledLog } from "@/lib/server/bundledLogs";

export const dynamic = "force-dynamic";

/** The agent's reasoning log for an account (written by services/agent), newest last. */
export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!isAddress(account)) return jsonResponse({ error: "Not an address" }, { status: 400 });
  try {
    const raw = await readFile(join(DATA_DIR, "agent-logs", `${account.toLowerCase()}.jsonl`), "utf8");
    const records = raw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as unknown)
      .slice(-100);
    return jsonResponse({ records });
  } catch {
    // No local log (e.g. on Vercel): fall back to the copy shipped with the app, if this account has one.
    return jsonResponse({ records: (bundledLog(account) ?? []).slice(-100) });
  }
}
