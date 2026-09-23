import { isAddress, type Address } from "viem";
import {
  RULE_NAMES,
  bondVaultAbi,
  describeLimit,
  mandateAccountAbi,
  mandateRegistryAbi,
  readAccountState,
  readMonitors,
  readRules,
} from "@mandate/common";
import { deployment, net, pub } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

/**
 * Live account view: venue state, the mandate and its rules, every rule's monitor, the bond and any breaches.
 *
 * Public Monad RPCs allow 15 requests/sec, and one view costs a dozen reads, so the whole response is cached for a
 * beat and shared across pollers. With a private RPC (the QuickNode perk) this can drop to zero.
 */
const VIEW_CACHE_MS = 2_000;
const viewCache = new Map<string, { at: number; body: Record<string, unknown> }>();

export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!isAddress(account)) return jsonResponse({ error: "Not an address" }, { status: 400 });
  const cached = viewCache.get(account);
  if (cached && Date.now() - cached.at < VIEW_CACHE_MS) return jsonResponse(cached.body);
  const dep = deployment();
  const addr = account as Address;

  const [block, state, { exists, active, rules }, mandateId, owner, sessionKey, breached] = await Promise.all([
    pub.getBlockNumber(),
    readAccountState(pub, dep.perplAdapter, addr),
    readRules(pub, dep.mandateRegistry, addr),
    pub.readContract({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "mandateIdOf", args: [addr] }),
    pub.readContract({ address: addr, abi: mandateAccountAbi, functionName: "owner" }),
    pub.readContract({ address: addr, abi: mandateAccountAbi, functionName: "sessionKey" }),
    pub.readContract({ address: addr, abi: mandateAccountAbi, functionName: "breached" }),
  ]);
  const monitors = exists ? await readMonitors(pub, addr, rules.length) : [];
  const mandate =
    mandateId > 0n
      ? (await pub.readContract({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "getMandate", args: [mandateId] }))[0]
      : null;

  const body = {
    network: net.key,
    block,
    account: addr,
    owner,
    sessionKey,
    closeOnly: breached || (exists && !active),
    mandate: mandate && { id: mandateId, ...mandate },
    state,
    rules: rules.map((r, i) => ({ ...r, name: RULE_NAMES[r.kind], limit: describeLimit(r, net), monitor: monitors[i] })),
    ...(await bondAndBreaches(addr)),
  };
  viewCache.set(account, { at: Date.now(), body });
  return jsonResponse(body);
}

/**
 * Bonds and breaches change rarely but cost several RPC calls, and the page polls every 1.5 s. Public Monad RPCs
 * rate-limit that, so these are cached briefly and a failure degrades to the last value rather than a 500.
 */
const CACHE_MS = 8_000;
const cache = new Map<string, { at: number; bond: Awaited<ReturnType<typeof readBond>>; breaches: Awaited<ReturnType<typeof readBreaches>> }>();

async function bondAndBreaches(account: Address) {
  const hit = cache.get(account);
  if (hit && Date.now() - hit.at < CACHE_MS) return { bond: hit.bond, breaches: hit.breaches };
  try {
    const [bond, breaches] = await Promise.all([readBond(account), readBreaches(account)]);
    cache.set(account, { at: Date.now(), bond, breaches });
    return { bond, breaches };
  } catch {
    // Keep serving the last good answer; the next poll retries.
    return { bond: hit?.bond ?? null, breaches: hit?.breaches ?? [] };
  }
}

/** The operator's bond, or null when none was posted. */
async function readBond(account: Address) {
  const dep = deployment();
  const [amount, operator] = await Promise.all([
    pub.readContract({ address: dep.bondVault, abi: bondVaultAbi, functionName: "bondOf", args: [account] }),
    pub.readContract({ address: dep.bondVault, abi: bondVaultAbi, functionName: "operatorOf", args: [account] }),
  ]);
  return operator === "0x0000000000000000000000000000000000000000" ? null : { amount, operator };
}

/**
 * This account's breaches. The keeper flags them in BondVault, not in the account, so the split screen would
 * otherwise miss the moment the market broke a rule.
 *
 * Read from contract state, not logs: Monad's public RPC caps `eth_getLogs` at a 100-block range, so scanning back
 * to the deployment would take hundreds of requests. The Envio indexer is the real answer for history (PRD 10.3);
 * this direct read keeps the page working before the indexer is up, and stops at MAX_SCAN breaches.
 */
const MAX_SCAN = 200n;

async function readBreaches(account: Address) {
  const dep = deployment();
  const count = await pub.readContract({ address: dep.bondVault, abi: bondVaultAbi, functionName: "breachCount" });
  const first = count > MAX_SCAN ? count - MAX_SCAN : 0n;
  const ids = Array.from({ length: Number(count - first) }, (_, i) => first + BigInt(i));
  const all = await Promise.all(
    ids.map(async (id) => ({
      id,
      b: await pub.readContract({ address: dep.bondVault, abi: bondVaultAbi, functionName: "getBreach", args: [id] }),
    })),
  );
  return all
    .filter(({ b }) => b.account.toLowerCase() === account.toLowerCase())
    .map(({ id, b }) => ({
      id,
      ruleIndex: Number(b.ruleIndex),
      observed: b.observed,
      limit: b.limit,
      flaggedAtBlock: b.blockNumber,
      peakEquity: b.peakEquity,
      equityAtFlag: b.equityAtFlag,
      disputed: b.disputed,
      resolved: b.resolved,
      upheld: b.upheld,
      slashed: b.slashed,
      /** What the backer was paid, once slashed: the loss from peak, capped at the bond. */
      loss: b.peakEquity > BigInt(b.equityAtFlag) ? b.peakEquity - BigInt(b.equityAtFlag) : 0n,
    }));
}
