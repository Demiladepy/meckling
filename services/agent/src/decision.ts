// The agent's decision: one structured intent per loop. Providers (Claude, Kimi, scripted demo) all return this.
import { z } from "zod";

export const DecisionSchema = z.object({
  action: z.enum(["open_long", "open_short", "close", "hold"]),
  market: z.enum(["BTC", "ETH", "MON", "SOL"]),
  /** Target notional to add (opens) or remove (close), in USD. Ignored for hold. */
  size_usd: z.number().nonnegative(),
  /** One or two plain sentences, shown on the split screen. */
  reasoning: z.string(),
});

export type Decision = z.infer<typeof DecisionSchema>;

export interface DecisionContext {
  block: bigint;
  network: string;
  equityUsd: number;
  positions: { market: string; side: "long" | "short"; notionalUsd: number; upnlUsd: number }[];
  marks: Record<string, number>;
  /** Plain-language mandate limits and current headroom. */
  limits: string[];
  cooldownBlocksLeft: number;
  /** The mandate leverage limit (x), if the mandate has one. */
  maxLeverage?: number;
  /** Per-market notional caps in USD, from MaxNotionalPerMarket rules. */
  marketCapsUsd: Record<string, number>;
  /** Nansen evidence summaries per market. */
  signals: Record<string, string[]>;
  /** The last few decisions and what the chain did with them. */
  history: { block: string; intent: string; result: string }[];
}

export interface DecisionProvider {
  readonly name: string;
  decide(ctx: DecisionContext): Promise<Decision>;
}
