// Demo mode (PRD section 8): a scripted sequence that deliberately proposes one rule-breaking trade so the demo is
// repeatable. Disclosed in the README. After the script ends it hands over to the fallback provider, or holds.
import type { Decision, DecisionContext, DecisionProvider } from "../decision.ts";

export interface ScriptStep {
  decide(ctx: DecisionContext): Decision;
}

/** 12x against the leverage limit, then back inside it. Sizes are relative to live equity. */
export function defaultDemoScript(market: "BTC" | "ETH" = "BTC"): ScriptStep[] {
  // Trade in the direction of the Nansen evidence, so the story reads straight: "net short" -> short.
  const sideOf = (ctx: DecisionContext) => (ctx.signals[market]?.some((s) => s.includes("net short")) ? "short" : "long");
  return [
    {
      decide: (ctx) => {
        const side = sideOf(ctx);
        return {
          action: side === "short" ? "open_short" : "open_long",
          market,
          size_usd: Math.round(ctx.equityUsd * 12),
          reasoning: `${ctx.signals[market]?.[0] ?? `Smart money is buying ${market}.`} Going 12x ${side}.`,
        };
      },
    },
    {
      decide: (ctx) => {
        const side = sideOf(ctx);
        // Back inside the limit with room to spare: 2.5x under a 3x limit, or 80% of any tighter limit.
        const target = ctx.maxLeverage ? Math.min(2.5, Math.floor(ctx.maxLeverage * 0.8 * 10) / 10) : 2.5;
        const limit = ctx.maxLeverage ? `${ctx.maxLeverage}x` : "the limit";
        const cap = ctx.marketCapsUsd[market];
        const size = Math.floor(Math.min(ctx.equityUsd * target, cap !== undefined ? cap * 0.9 : Infinity));
        const lev = Math.round((size / ctx.equityUsd) * 10) / 10;
        return {
          action: side === "short" ? "open_short" : "open_long",
          market,
          size_usd: size,
          reasoning:
            cap !== undefined && size < ctx.equityUsd * target
              ? `Limit is ${limit} and $${cap} on ${market}. Going ${lev}x ${side}.`
              : `Limit is ${limit}. Going ${lev}x ${side}.`,
        };
      },
    },
  ];
}

export class ScriptedProvider implements DecisionProvider {
  readonly name = "scripted-demo";
  private step = 0;
  private readonly steps: ScriptStep[];
  private readonly then?: DecisionProvider;

  constructor(steps: ScriptStep[], then?: DecisionProvider) {
    this.steps = steps;
    this.then = then;
  }

  async decide(ctx: DecisionContext): Promise<Decision> {
    const s = this.steps[this.step];
    if (s) {
      this.step++;
      return s.decide(ctx);
    }
    if (this.then) return this.then.decide(ctx);
    return { action: "hold", market: "BTC", size_usd: 0, reasoning: "Script finished. Holding." };
  }
}
