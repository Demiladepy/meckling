// Kimi decision provider (optional Kimi bounty, PRD section 3). Moonshot's chat completions API with JSON mode.
// Base URL and model come from env so the owner can point this at the endpoint their Kimi key is issued for.
import { DecisionSchema, type Decision, type DecisionContext, type DecisionProvider } from "../decision.ts";
import { SYSTEM_PROMPT, renderContext } from "./prompt.ts";

const JSON_INSTRUCTION =
  'Respond with only a JSON object: {"action": "open_long"|"open_short"|"close"|"hold", "market": "BTC"|"ETH"|"MON"|"SOL", "size_usd": number, "reasoning": string}.';

export class KimiProvider implements DecisionProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { apiKey: string; baseUrl: string; model: string }) {
    if (!opts.apiKey) throw new Error("KIMI_API_KEY is not set");
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.model = opts.model;
    this.name = `kimi:${opts.model}`;
  }

  async decide(ctx: DecisionContext): Promise<Decision> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_INSTRUCTION}` },
          { role: "user", content: renderContext(ctx) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Kimi returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = DecisionSchema.safeParse(JSON.parse(body.choices?.[0]?.message?.content ?? "{}"));
    if (!parsed.success) return { action: "hold", market: "BTC", size_usd: 0, reasoning: "My last answer was malformed, so I'm holding." };
    return parsed.data;
  }
}
