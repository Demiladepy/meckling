// JSON that carries bigints as strings (the chain speaks bigint; HTTP does not).
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

export function jsonResponse(value: unknown, init?: ResponseInit): Response {
  return new Response(toJson(value), { ...init, headers: { "content-type": "application/json", ...init?.headers } });
}
