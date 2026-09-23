import { net } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

/**
 * Same-origin JSON-RPC proxy.
 *
 * A private endpoint carries its credential in the URL (QuickNode puts a token in the path), so the browser must
 * never see it. The app's client talks to this route instead and the token stays on the server.
 *
 * Only the methods the app actually uses are forwarded, so this can't be borrowed as a general-purpose node.
 */
const ALLOWED = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getLogs",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
  "eth_sendRawTransaction",
  "net_version",
]);

type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

export async function POST(req: Request) {
  let body: Call | Call[];
  try {
    body = (await req.json()) as Call | Call[];
  } catch {
    return jsonResponse({ error: "Bad JSON" }, { status: 400 });
  }

  // viem batches calls into an array, so both shapes have to be checked.
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > 64) return jsonResponse({ error: "Bad batch size" }, { status: 400 });
  const blocked = calls.find((c) => typeof c.method !== "string" || !ALLOWED.has(c.method));
  if (blocked) {
    return jsonResponse({ error: `Method not allowed: ${String(blocked.method)}` }, { status: 403 });
  }

  const upstream = await fetch(net.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
