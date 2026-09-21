import { AGENT, NETWORK, net } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

/** Public network config for the browser: chain, RPC, contract addresses, markets, the offered agent. */
export function GET() {
  return jsonResponse({
    network: NETWORK,
    chainId: net.chain.id,
    rpcUrl: net.rpcUrl,
    markets: net.markets,
    deployment: net.deployment ?? null,
    agent: AGENT,
    devFaucet: NETWORK === "local",
  });
}
