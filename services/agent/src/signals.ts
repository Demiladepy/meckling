// Where the agent's Nansen evidence comes from.
//
// The mandate already points at the underwriting report that justified its limits (reportHash on-chain, the JSON in
// data/reports). The agent reads that first: it is the evidence the backer approved, and it costs no credits. Live
// Nansen calls only happen when NANSEN_REFRESH_MIN is set, and a failed refresh keeps the stored evidence.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, PublicClient } from "viem";
import { mandateRegistryAbi, type MarketSymbol, type NetworkConfig } from "@mandate/common";
import { NansenClient, assessMarket, type UnderwritingReport } from "underwriter";
import { DATA_DIR } from "./config.ts";

export type SignalSource = (markets: MarketSymbol[]) => Promise<Record<string, string[]>>;

function reportFor(pub: PublicClient, registry: Address, account: Address): Promise<`0x${string}` | undefined> {
  return pub
    .readContract({ address: registry, abi: mandateRegistryAbi, functionName: "mandateIdOf", args: [account] })
    .then(async (id) => {
      if (id === 0n) return undefined;
      const [m] = await pub.readContract({ address: registry, abi: mandateRegistryAbi, functionName: "getMandate", args: [id] });
      return m.reportHash === `0x${"0".repeat(64)}` ? undefined : m.reportHash;
    })
    .catch(() => undefined);
}

function readReport(hash: string): UnderwritingReport | undefined {
  const file = join(DATA_DIR, "reports", `${hash.toLowerCase()}.json`);
  if (!existsSync(file)) return undefined;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as UnderwritingReport;
  } catch {
    return undefined;
  }
}

function linesFrom(report: UnderwritingReport, markets: MarketSymbol[], stale: boolean): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const age = `from the underwriting report of ${report.createdAt.slice(0, 10)}`;
  for (const s of markets) {
    const m = report.markets.find((x) => x.symbol === s);
    if (!m) continue;
    const suffix = report.source === "fixture" ? " (sample data)" : stale ? ` (${age})` : "";
    out[s] = [...m.reasons.map((r) => r + suffix), `Nansen regime for ${s}: ${m.regime}.`];
  }
  return out;
}

export function makeSignalSource(opts: {
  env: NodeJS.ProcessEnv;
  net: NetworkConfig;
  pub: PublicClient;
  account: Address;
}): SignalSource {
  const { env, net, pub, account } = opts;
  const refreshMin = Number(env.NANSEN_REFRESH_MIN || 0);
  const client = env.NANSEN_API_KEY ? new NansenClient(env.NANSEN_API_KEY) : undefined;
  let cache: { at: number; lines: Record<string, string[]> } | undefined;
  let stored: UnderwritingReport | undefined;

  return async (markets) => {
    if (!stored && net.deployment) {
      const hash = await reportFor(pub, net.deployment.mandateRegistry, account);
      if (hash) stored = readReport(hash);
    }
    const fresh = cache && refreshMin > 0 && Date.now() - cache.at < refreshMin * 60_000;
    if (fresh) return cache!.lines;

    if (client && refreshMin > 0) {
      try {
        const lines: Record<string, string[]> = {};
        for (const s of markets) {
          const m = net.markets.find((x) => x.symbol === s);
          if (!m) continue;
          const a = await assessMarket(client, s, m.perpId, { total: 0 });
          // A market with no usable signal falls back to the stored report rather than reporting "no signal".
          const usable = a.positioning.available || a.flows.available;
          lines[s] = usable ? [...a.reasons, `Nansen regime for ${s}: ${a.regime}.`] : (stored ? linesFrom(stored, [s], true)[s] ?? a.reasons : a.reasons);
        }
        cache = { at: Date.now(), lines };
        return lines;
      } catch {
        // fall through to the stored report
      }
    }
    const lines = stored ? linesFrom(stored, markets, true) : Object.fromEntries(markets.map((s) => [s, ["No Nansen evidence is available for this account."]]));
    cache = { at: Date.now(), lines };
    return lines;
  };
}
