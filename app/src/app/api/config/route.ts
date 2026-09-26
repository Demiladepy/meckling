import { AGENT, NETWORK, net } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

/**
 * A private RPC carries its credential in the URL (QuickNode puts a token in the path), and this response is public,
 * so the browser is given the same-origin proxy instead. A credential-free URL is passed through unchanged, which
 * keeps local anvil a direct connection.
 */
function browserRpcUrl(req: Request): string {
  try {
    const u = new URL(net.rpcUrl);
    const hasCredential = u.username !== "" || u.password !== "" || u.search !== "" || u.pathname.replace(/\/+$/, "") !== "";
    if (!hasCredential) return net.rpcUrl;
  } catch {
    // Not parseable: assume it is private.
  }
  return new URL("/api/rpc", req.url).toString();
}

/** Public network config for the browser: chain, RPC, contract addresses, markets, the offered agent. */
export function GET(req: Request) {
  return jsonResponse({
    network: NETWORK,
    chainId: net.chain.id,
    rpcUrl: browserRpcUrl(req),
    markets: net.markets,
    deployment: net.deployment ?? null,
    agent: AGENT,
    devFaucet: NETWORK === "local",
    /** True when underwriting hits live Nansen (not a local fixture). */
    nansenLive: Boolean(process.env.NANSEN_API_KEY),
  });
}
