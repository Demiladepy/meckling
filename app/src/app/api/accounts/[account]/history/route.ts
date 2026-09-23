import { isAddress } from "viem";
import { gql, hasIndexer } from "@/lib/server/indexer";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

/**
 * An account's history: equity curve, blocked attempts, breach timeline and the track record derived from them
 * (PRD 10.3). All of it comes from the Envio indexer, because Monad full nodes serve no historical state.
 *
 * With no indexer configured this answers `{ indexer: false }` and the caller shows live state only.
 */
const QUERY = `
query History($id: String!) {
  Account(where: { id: { _eq: $id } }) {
    executions
    violationsAttempted
    breaches
    peakEquity
    lastEquity
  }
  EquityPoint(where: { account_id: { _eq: $id } }, order_by: { blockNumber: asc }, limit: 1000) {
    blockNumber
    equity
    peakEquity
    source
  }
  Violation(where: { account_id: { _eq: $id } }, order_by: { blockNumber: desc }, limit: 50) {
    blockNumber
    ruleIndex
    observed
    limit
    txHash
  }
  Breach(where: { account_id: { _eq: $id } }, order_by: { flaggedAtBlock: desc }) {
    id
    ruleIndex
    observed
    limit
    flaggedAtBlock
    flaggedTxHash
    disputed
    resolved
    upheld
    slashed
    slashAmount
  }
}`;

interface Raw {
  Account: { executions: number; violationsAttempted: number; breaches: number; peakEquity: string | null; lastEquity: string | null }[];
  EquityPoint: { blockNumber: string; equity: string | null; peakEquity: string | null; source: string }[];
  Violation: { blockNumber: string; ruleIndex: number; observed: string; limit: string; txHash: string }[];
  Breach: Record<string, unknown>[];
}

const CACHE_MS = 5_000;
const cache = new Map<string, { at: number; body: Record<string, unknown> }>();

export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!isAddress(account)) return jsonResponse({ error: "Not an address" }, { status: 400 });
  if (!hasIndexer()) return jsonResponse({ indexer: false, reason: "ENVIO_GRAPHQL_URL is not set" });

  const id = account.toLowerCase();
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return jsonResponse(hit.body);

  let data: Raw;
  try {
    data = await gql<Raw>(QUERY, { id });
  } catch (e) {
    // The live screens don't depend on this, so a down indexer degrades instead of failing the page.
    return jsonResponse({ indexer: false, reason: (e as Error).message }, { status: 200 });
  }

  const acct = data.Account[0];
  const curve = data.EquityPoint.filter((p) => p.equity !== null).map((p) => ({
    block: p.blockNumber,
    equity: p.equity as string,
    peakEquity: p.peakEquity,
    source: p.source,
  }));

  const body = {
    indexer: true,
    account: id,
    trackRecord: {
      executions: acct?.executions ?? 0,
      violationsAttempted: acct?.violationsAttempted ?? 0,
      breaches: acct?.breaches ?? 0,
      peakEquity: acct?.peakEquity ?? null,
      equity: acct?.lastEquity ?? null,
      /** Worst peak-to-trough fall across the curve, in basis points — the number a backer actually judges. */
      maxDrawdownBps: maxDrawdownBps(curve.map((p) => BigInt(p.equity))),
      returnBps: returnBps(curve.map((p) => BigInt(p.equity))),
    },
    curve,
    violations: data.Violation,
    breaches: data.Breach,
  };
  cache.set(id, { at: Date.now(), body });
  return jsonResponse(body);
}

/** Same definition the MaxDrawdown rule enforces on-chain: the fall from the running equity peak. */
function maxDrawdownBps(equities: bigint[]): number {
  let peak = 0n;
  let worst = 0;
  for (const e of equities) {
    if (e > peak) peak = e;
    if (peak > 0n && e < peak) {
      const dd = Number(((peak - e) * 10_000n) / peak);
      if (dd > worst) worst = dd;
    }
  }
  return worst;
}

/** Return since the first recorded equity, in basis points. */
function returnBps(equities: bigint[]): number | null {
  const first = equities[0];
  const last = equities[equities.length - 1];
  if (first === undefined || last === undefined || first <= 0n) return null;
  return Number(((last - first) * 10_000n) / first);
}
