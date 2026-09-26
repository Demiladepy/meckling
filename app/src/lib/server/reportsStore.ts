/** In-memory underwriting reports so verify works across /tmp and warm serverless instances. */
const mem = new Map<string, string>();

export function storeReport(hash: string, body: string) {
  mem.set(hash.toLowerCase(), body);
}

export function readStoredReport(hash: string): string | undefined {
  return mem.get(hash.toLowerCase());
}
