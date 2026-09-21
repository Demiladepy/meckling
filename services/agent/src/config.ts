// Agent configuration from env. See .env.example.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { loadNetwork } from "@mandate/common/node";
import type { MarketSymbol, NetworkKey } from "@mandate/common";
import { NansenClient, assessMarket, fixtureClient } from "underwriter";
import type { DecisionProvider } from "./decision.ts";
import { ClaudeProvider } from "./providers/claude.ts";
import { KimiProvider } from "./providers/kimi.ts";
import { ScriptedProvider, defaultDemoScript } from "./providers/scripted.ts";
import type { AgentConfig } from "./runtime.ts";

/** Repo-level data/ (gitignored): agent-logs/ for decision logs, reports/ for underwriting reports. */
export const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../data");
export const AGENT_DATA_DIR = join(DATA_DIR, "agent-logs");

export function logPathFor(account: Address) {
  return join(AGENT_DATA_DIR, `${account.toLowerCase()}.jsonl`);
}

function need(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is not set`);
  return v;
}

export function llmProvider(env: NodeJS.ProcessEnv): DecisionProvider | undefined {
  switch (env.LLM_PROVIDER) {
    case "claude":
      return new ClaudeProvider({
        model: env.CLAUDE_MODEL || undefined,
        effort: (env.CLAUDE_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) || undefined,
      });
    case "kimi":
      return new KimiProvider({
        apiKey: need(env, "KIMI_API_KEY"),
        baseUrl: need(env, "KIMI_BASE_URL"),
        model: need(env, "KIMI_MODEL"),
      });
    case undefined:
    case "":
    case "none":
      return undefined;
    default:
      throw new Error(`Unknown LLM_PROVIDER ${env.LLM_PROVIDER} (claude | kimi | none)`);
  }
}

/** Nansen evidence as short sentences per market, cached so a fast loop doesn't burn credits. */
export function nansenSignals(env: NodeJS.ProcessEnv, net: ReturnType<typeof loadNetwork>, ttlMs = 10 * 60_000) {
  const live = Boolean(env.NANSEN_API_KEY);
  const client = live ? new NansenClient(env.NANSEN_API_KEY!) : fixtureClient();
  const cache = new Map<string, { at: number; lines: string[] }>();
  return async (markets: MarketSymbol[]) => {
    const out: Record<string, string[]> = {};
    await Promise.all(
      markets.map(async (s) => {
        const hit = cache.get(s);
        if (hit && Date.now() - hit.at < ttlMs) {
          out[s] = hit.lines;
          return;
        }
        const m = net.markets.find((x) => x.symbol === s)!;
        const a = await assessMarket(client, s, m.perpId, { total: 0 });
        const lines = [...a.reasons, `Nansen regime for ${s}: ${a.regime}.`].map((l) => (live ? l : `${l} (sample data)`));
        cache.set(s, { at: Date.now(), lines });
        out[s] = lines;
      }),
    );
    return out;
  };
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const net = loadNetwork((env.NETWORK as NetworkKey) || "local", env);
  const mandateAccount = need(env, "MANDATE_ACCOUNT") as Address;
  const sessionKey = privateKeyToAccount(need(env, "AGENT_SESSION_PRIVATE_KEY") as Hex);
  const demo = env.DEMO_MODE === "1";
  const llm = llmProvider(env);
  const provider = demo ? new ScriptedProvider(defaultDemoScript((env.DEMO_MARKET as "BTC" | "ETH") || "BTC"), llm) : llm;
  if (!provider) throw new Error("Set LLM_PROVIDER (claude | kimi) or DEMO_MODE=1");
  return {
    net,
    mandateAccount,
    sessionKey,
    provider,
    loopBlocks: Number(env.AGENT_LOOP_BLOCKS || 30),
    logPath: env.AGENT_LOG_PATH || logPathFor(mandateAccount),
    demo,
    venueLeverage: Number(env.AGENT_VENUE_LEVERAGE || 15),
    slippageBps: Number(env.AGENT_SLIPPAGE_BPS || 100),
    signals: nansenSignals(env, net),
  };
}
