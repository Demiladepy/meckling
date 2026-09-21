import { createWalletClient, http, isAddress, parseAbi, type Address } from "viem";
import { usdToCns } from "@mandate/common";
import { NETWORK, deployment, net, pub } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";

export const dynamic = "force-dynamic";

/**
 * LOCAL FORK ONLY. Gives a new passkey account gas (MON) and, optionally, sends AUSD to a MandateAccount, borrowing
 * it from Perpl's exchange balance on the fork. Refuses on any real network.
 */
export async function POST(req: Request) {
  if (NETWORK !== "local") return jsonResponse({ error: "The dev faucet only runs on a local fork." }, { status: 403 });
  const { gasTo, ausdTo, ausdUsd } = (await req.json()) as { gasTo?: string; ausdTo?: string; ausdUsd?: number };
  const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });

  if (gasTo && isAddress(gasTo)) await rpc("anvil_setBalance", [gasTo, "0x8AC7230489E80000"]); // 10 MON

  if (ausdTo && isAddress(ausdTo)) {
    const dep = deployment();
    await rpc("anvil_impersonateAccount", [dep.perplExchange]);
    await rpc("anvil_setBalance", [dep.perplExchange, "0x8AC7230489E80000"]);
    const whale = createWalletClient({ chain: net.chain, transport: http(net.rpcUrl), account: dep.perplExchange });
    const hash = await whale.writeContract({
      address: dep.collateralToken,
      abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
      functionName: "transfer",
      args: [ausdTo as Address, usdToCns(Math.min(ausdUsd ?? 100, 10_000))],
    });
    await pub.waitForTransactionReceipt({ hash });
    await rpc("anvil_stopImpersonatingAccount", [dep.perplExchange]);
  }
  return jsonResponse({ ok: true });
}
