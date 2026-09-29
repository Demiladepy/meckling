import { isAddress, isHex, verifyMessage, type Address, type Hex } from "viem";
import { mandateRegistryAbi, memoryKeyMessage } from "@mandate/common";
import { deployment, pub } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";
import { hasRecordStore, memoryPublicKey, setMemoryPublicKey } from "@/lib/server/records";

export const dynamic = "force-dynamic";

/**
 * The backer's memory public key for an agent (D13). Once set, the agent seals its reasoning to it, and only the
 * backer's passkey can read it.
 *
 * Registering needs a signature from the mandate's backer as recorded on-chain; otherwise anyone could point the agent
 * at their own key and read the strategy, or blank it out for the real backer.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!isAddress(account)) return jsonResponse({ error: "Not an address" }, { status: 400 });
  return jsonResponse({ available: hasRecordStore(), publicKey: (await memoryPublicKey(account).catch(() => undefined)) ?? null });
}

export async function POST(req: Request, { params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!isAddress(account)) return jsonResponse({ error: "Not an address" }, { status: 400 });
  if (!hasRecordStore()) return jsonResponse({ error: "Private reasoning isn't set up on this server." }, { status: 503 });

  let publicKey: Hex;
  let signature: Hex;
  try {
    const body = (await req.json()) as { publicKey?: string; signature?: string };
    if (!body.publicKey || !isHex(body.publicKey) || body.publicKey.length !== 66) throw new Error();
    if (!body.signature || !isHex(body.signature)) throw new Error();
    publicKey = body.publicKey;
    signature = body.signature;
  } catch {
    return jsonResponse({ error: "Send a 32-byte public key and a signature." }, { status: 400 });
  }

  const dep = deployment();
  const mandateId = (await pub.readContract({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "mandateIdOf", args: [account as Address] })) as bigint;
  if (mandateId === 0n) return jsonResponse({ error: "This account has no mandate." }, { status: 404 });
  const [mandate] = (await pub.readContract({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "getMandate", args: [mandateId] })) as readonly [{ backer: Address }, ...unknown[]];

  const ok = await verifyMessage({ address: mandate.backer, message: memoryKeyMessage(account as Address, publicKey), signature });
  if (!ok) return jsonResponse({ error: "Only this agent's backer can make its reasoning private." }, { status: 403 });

  await setMemoryPublicKey(account as Address, publicKey.toLowerCase());
  return jsonResponse({ ok: true, publicKey: publicKey.toLowerCase() });
}
