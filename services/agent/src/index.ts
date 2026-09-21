// Agent runtime entry point: pnpm --filter agent start
import { measureBlockTimeMs } from "@mandate/common";
import { loadAgentConfig } from "./config.ts";
import { AgentRuntime } from "./runtime.ts";

const cfg = loadAgentConfig();
const agent = new AgentRuntime(cfg);
const blockMs = await measureBlockTimeMs(agent.pub, 200n).catch(() => NaN);
console.log(
  `Mandate agent · ${cfg.provider.name} · ${cfg.net.key} · account ${cfg.mandateAccount} · session key ${cfg.sessionKey.address}`,
);
console.log(`Block time ~${Number.isFinite(blockMs) ? blockMs.toFixed(0) : "?"} ms; deciding every ${cfg.loopBlocks} blocks.${cfg.demo ? " DEMO MODE (scripted)." : ""}`);
console.log(`Log: ${cfg.logPath}`);

process.on("SIGINT", () => agent.stop());
await agent.run(process.env.AGENT_MAX_ROUNDS ? Number(process.env.AGENT_MAX_ROUNDS) : Infinity);
