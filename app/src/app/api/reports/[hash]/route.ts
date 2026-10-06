import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "@/lib/server/env";
import { readStoredReport } from "@/lib/server/reportsStore";
import { storedReport } from "@/lib/server/records";

/** Reports shipped with the app as static files (public/reports), byte-exact. */
const BUNDLED = new Set([
  "0x0882f77cc1ac9fa615372254d3a4dd0bc2e29caa5a2af5128883237c112c9a66",
  "0x977e286d510488cef67012b6f9c9a1c25ceaab30be6f3556ca0be487aecbe171",
]);
const HEADERS = { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable" };

/** The stored underwriting report. Its keccak256 is the mandate's on-chain reportHash, so anyone can verify it. */
export async function GET(req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) return new Response("Not found", { status: 404 });
  const key = hash.toLowerCase();
  const fromMem = readStoredReport(key);
  if (fromMem) return new Response(fromMem, { headers: HEADERS });
  try {
    const fromStore = await storedReport(key);
    if (fromStore) return new Response(fromStore, { headers: HEADERS });
  } catch (e) {
    console.error("report store unavailable", e);
  }
  try {
    return new Response(await readFile(join(DATA_DIR, "reports", `${key}.json`), "utf8"), { headers: HEADERS });
  } catch {
    if (BUNDLED.has(key)) return Response.redirect(new URL(`/reports/${key}.json`, req.url), 302);
    return new Response("Not found", { status: 404 });
  }
}
