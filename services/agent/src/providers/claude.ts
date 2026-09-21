// Claude decision provider: one structured-output call per loop (claude-opus-5, adaptive thinking).
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { DecisionSchema, type Decision, type DecisionContext, type DecisionProvider } from "../decision.ts";
import { SYSTEM_PROMPT, renderContext } from "./prompt.ts";

export class ClaudeProvider implements DecisionProvider {
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: "low" | "medium" | "high" | "xhigh" | "max";

  constructor(opts: { model?: string; effort?: "low" | "medium" | "high" | "xhigh" | "max"; client?: Anthropic } = {}) {
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? "claude-opus-5";
    this.effort = opts.effort ?? "high";
    this.name = `claude:${this.model}`;
  }

  async decide(ctx: DecisionContext): Promise<Decision> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: this.effort, format: betaZodOutputFormat(DecisionSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: renderContext(ctx) }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return { action: "hold", market: "BTC", size_usd: 0, reasoning: "No decision this round, so I'm holding." };
    }
    return response.parsed_output;
  }
}
