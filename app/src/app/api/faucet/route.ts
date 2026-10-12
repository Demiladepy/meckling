import { createWalletClient, erc20Abi, formatEther, http, isAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deployment, net, NETWORK, pub } from "@/lib/server/env";
import { jsonResponse } from "@/lib/json";
import { AUSD_DRIP, AUSD_LOW, MON_DRIP, MON_LOW, perAddress, perIp } from "@/lib/server/faucet";

export const dynamic = "force-dynamic";

/**
 * Judge faucet (testnet only). Someone arriving with a brand-new passkey account has no test MON for gas and no AUSD,
 * so they could not try anything. This sends just enough of each, from a dedicated faucet wallet (never the deployer).
 *
 * Limits live in Upstash Redis so they hold across serverless instances: one drip per address and three per IP a day.
 * It only sends what the wallet is short of: MON when it can't pay for a few transactions, AUSD when it holds less
 * than Perpl's minimum to open an account (100 AUSD on testnet).
 */
export async function POST(req: Request) {
  if (NETWORK !== "testnet") return jsonResponse({ error: "The faucet only runs on testnet." }, { status: 404 });
  const key = process.env.FAUCET_PRIVATE_KEY as Hex | undefined;
  if (!key || !perAddress || !perIp) return jsonResponse({ error: "The faucet isn't set up on this server." }, { status: 503 });

  let to: Address;
  try {
    const body = (await req.json()) as { address?: string };
    if (!body.address || !isAddress(body.address)) throw new Error();
    to = body.address as Address;
  } catch {
    return jsonResponse({ error: "Send a valid address." }, { status: 400 });
  }

  const dep = deployment();
  const faucet = privateKeyToAccount(key);
  const wallet = createWalletClient({ chain: net.chain, transport: http(net.rpcUrl), account: faucet });
  const [mon, ausd, faucetMon, faucetAusd] = await Promise.all([
    pub.getBalance({ address: to }),
    pub.readContract({ address: dep.collateralToken, abi: erc20Abi, functionName: "balanceOf", args: [to] }),
    pub.getBalance({ address: faucet.address }),
    pub.readContract({ address: dep.collateralToken, abi: erc20Abi, functionName: "balanceOf", args: [faucet.address] }),
  ]);

  const needMon = mon < MON_LOW;
  const needAusd = ausd < AUSD_LOW;
  if (!needMon && !needAusd) {
    return jsonResponse({ sent: false, message: "This account already has enough to try Meckling." });
  }
  // Gas for the faucet's own sends, so it never strands itself mid-drip.
  if ((needMon && faucetMon < MON_DRIP + parseEther("0.02")) || (needAusd && (faucetAusd < AUSD_DRIP || faucetMon < parseEther("0.02")))) {
    return jsonResponse({ error: "The faucet is empty right now. Message the team and we'll top it up." }, { status: 503 });
  }

  // Count the allowance only once a drip is certain to be sent, so an empty faucet never locks anyone out.
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
  const [byIp, byAddr] = await Promise.all([perIp.limit(ip), perAddress.limit(to.toLowerCase())]);
  if (!byIp.success || !byAddr.success) {
    const reset = Math.max(byIp.success ? 0 : byIp.reset, byAddr.success ? 0 : byAddr.reset);
    const hours = Math.max(1, Math.ceil((reset - Date.now()) / 3_600_000));
    return jsonResponse({ error: `You've already had test funds today. Try again in about ${hours} h.` }, { status: 429 });
  }

  const sent: { mon?: Hex; ausd?: Hex } = {};
  try {
    if (needMon) {
      // A plain transfer to an EOA costs exactly 21,000 gas; Monad charges the limit, so set exactly that.
      sent.mon = await wallet.sendTransaction({ to, value: MON_DRIP, gas: 21_000n, chain: net.chain });
      await pub.waitForTransactionReceipt({ hash: sent.mon });
    }
    if (needAusd) {
      const call = { address: dep.collateralToken, abi: erc20Abi, functionName: "transfer", args: [to, AUSD_DRIP], account: faucet } as const;
      const gas = ((await pub.estimateContractGas(call)) * 115n) / 100n;
      sent.ausd = await wallet.writeContract({ ...call, chain: net.chain, gas });
      await pub.waitForTransactionReceipt({ hash: sent.ausd });
    }
  } catch (e) {
    return jsonResponse({ error: `The faucet couldn't send: ${(e as Error).message.split("\n")[0]}` }, { status: 502 });
  }

  return jsonResponse({
    sent: true,
    mon: sent.mon ? { amount: formatEther(MON_DRIP), tx: sent.mon } : null,
    ausd: sent.ausd ? { amount: Number(AUSD_DRIP) / 1e6, tx: sent.ausd } : null,
  });
}
