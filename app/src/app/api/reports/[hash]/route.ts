import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "@/lib/server/env";

/** The stored underwriting report. Its keccak256 is the mandate's on-chain reportHash, so anyone can verify it. */
export async function GET(_req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) return new Response("Not found", { status: 404 });
  try {
    const body = await readFile(join(DATA_DIR, "reports", `${hash.toLowerCase()}.json`), "utf8");
    return new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
