import { isAddress, type Address } from "viem";
import {
  RULE_NAMES,
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

/** Live account view: venue state, the mandate and its rules, and every rule's monitor. Polled by the split screen. */
export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!isAddress(account)) return jsonResponse({ error: "Not an address" }, { status: 400 });
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

  return jsonResponse({
    network: net.key,
    block,
    account: addr,
    owner,
    sessionKey,
    closeOnly: breached || (exists && !active),
    mandate: mandate && { id: mandateId, ...mandate },
    state,
    rules: rules.map((r, i) => ({ ...r, name: RULE_NAMES[r.kind], limit: describeLimit(r, net), monitor: monitors[i] })),
  });
}
