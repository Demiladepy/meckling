import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { NansenClient, canonicalJson, fixtureClient, underwrite } from "underwriter";
import { DATA_DIR, net } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

const Body = z.object({
  markets: z.array(z.enum(["BTC", "ETH", "MON", "SOL"])).min(1).max(4),
  baseNotionalUsd: z.number().positive().max(10_000_000),
});

/**
 * Runs Nansen underwriting server-side (the API key never reaches the browser), stores the report under its hash,
 * and returns the evidence, proposed limits and reportHash. Without NANSEN_API_KEY it uses labelled sample data.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonResponse({ error: "Pick at least one market and a positive base size." }, { status: 400 });
  const live = Boolean(process.env.NANSEN_API_KEY);
  const result = await underwrite({
    nansen: live ? new NansenClient(process.env.NANSEN_API_KEY!) : fixtureClient(),
    net,
    symbols: parsed.data.markets,
    baseNotionalUsd: parsed.data.baseNotionalUsd,
    source: live ? "nansen" : "fixture",
  });
  await mkdir(join(DATA_DIR, "reports"), { recursive: true });
  await writeFile(join(DATA_DIR, "reports", `${result.reportHash}.json`), canonicalJson(result.report));
  return jsonResponse(result);
}
