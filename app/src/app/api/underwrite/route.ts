import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { NansenClient, canonicalJson, fixtureClient, underwrite } from "underwriter";
import { DATA_DIR, net } from "@/lib/server/env";
import { storeReport } from "@/lib/server/reportsStore";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

const Body = z.object({
  markets: z.array(z.enum(["BTC", "ETH", "MON", "SOL"])).min(1).max(4),
  baseNotionalUsd: z.number().positive().max(10_000_000),
});

/**
 * Runs Nansen underwriting server-side (the API key never reaches the browser), stores the report under its hash,
 * and returns the evidence, proposed limits and reportHash.
 *
 * Live Nansen is required for the judge-facing product. Fixture data is only allowed when
 * ALLOW_NANSEN_FIXTURE=1 (local engineering), never as a silent fallback.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return jsonResponse({ error: "Pick at least one market and a positive base size." }, { status: 400 });

  const live = Boolean(process.env.NANSEN_API_KEY);
  const allowFixture = process.env.ALLOW_NANSEN_FIXTURE === "1";
  if (!live && !allowFixture) {
    return jsonResponse(
      {
        error:
          "Nansen API key is not configured. Live underwriting is required — set NANSEN_API_KEY on the server.",
      },
      { status: 503 },
    );
  }

  const result = await underwrite({
    nansen: live ? new NansenClient(process.env.NANSEN_API_KEY!) : fixtureClient(),
    net,
    symbols: parsed.data.markets,
    baseNotionalUsd: parsed.data.baseNotionalUsd,
    source: live ? "nansen" : "fixture",
  });
  const body = canonicalJson(result.report);
  storeReport(result.reportHash, body);
  try {
    await mkdir(join(DATA_DIR, "reports"), { recursive: true });
    await writeFile(join(DATA_DIR, "reports", `${result.reportHash}.json`), body);
  } catch {
    // Vercel /tmp can fail under rare conditions; memory store still serves verify.
  }
  return jsonResponse(result);
}
