import "server-only";

/**
 * The Envio indexer (PRD 10.3). Monad full nodes serve no historical state and the public RPC caps `eth_getLogs`
 * at a 100-block range, so equity curves, blocked attempts and track records can only come from here.
 *
 * Optional by design: with no `ENVIO_GRAPHQL_URL` the history route answers "no indexer" and the live screens,
 * which read chain state directly, keep working.
 */
const URL_ = () => process.env.ENVIO_GRAPHQL_URL?.trim() || "";

export const hasIndexer = () => URL_().length > 0;

const TIMEOUT_MS = 8_000;

export async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const url = URL_();
  if (!url) throw new Error("No ENVIO_GRAPHQL_URL");
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  if (!body.data) throw new Error("Indexer returned no data");
  return body.data;
}
