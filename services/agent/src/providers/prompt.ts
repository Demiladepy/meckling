// Shared prompt for LLM providers. The mandate is enforced on-chain regardless of what the model decides; the prompt
// gives the model the limits so it can plan within them, and the history so it can adjust after a block.
import type { DecisionContext } from "../decision.ts";

export const SYSTEM_PROMPT = `You are a perpetual futures trading agent on Perpl (Monad). You trade a backer's capital under an on-chain mandate: every trade you submit is checked by the chain against the backer's risk rules, and a trade that breaks a rule reverts.

Each round you get the account state, the mandate's limits and headroom, Nansen smart-money evidence per market, and your recent decisions with what the chain did with them. Return exactly one decision:
- open_long / open_short: add size_usd of notional in one market.
- close: reduce an existing position in one market by size_usd (use the full position size to exit).
- hold: do nothing this round (size_usd 0).

Trade only when the evidence gives you a reason. Size so the result stays inside the limits; if the chain blocked your last trade, read why and adjust. Write reasoning as one or two plain sentences a backer would understand, citing the evidence you used.`;

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export function renderContext(ctx: DecisionContext): string {
  const lines: string[] = [];
  lines.push(`Block ${ctx.block} on ${ctx.network}.`);
  lines.push(`Equity: ${usd(ctx.equityUsd)}.`);
  lines.push(
    ctx.positions.length
      ? `Positions: ${ctx.positions.map((p) => `${p.market} ${p.side} ${usd(p.notionalUsd)} (uPnL ${usd(p.upnlUsd)})`).join("; ")}.`
      : "Positions: none.",
  );
  lines.push(`Marks: ${Object.entries(ctx.marks).map(([m, p]) => `${m} ${usd(p)}`).join(", ")}.`);
  lines.push("", "Mandate limits:", ...ctx.limits.map((l) => `- ${l}`));
  if (ctx.cooldownBlocksLeft > 0) lines.push(`Loss cooldown active: ${ctx.cooldownBlocksLeft} blocks left. Opening or adding will revert.`);
  lines.push("", "Nansen evidence:");
  for (const [m, s] of Object.entries(ctx.signals)) lines.push(`${m}:`, ...s.map((x) => `- ${x}`));
  if (ctx.history.length) {
    lines.push("", "Recent decisions:");
    for (const h of ctx.history) lines.push(`- block ${h.block}: ${h.intent} -> ${h.result}`);
  }
  return lines.join("\n");
}
