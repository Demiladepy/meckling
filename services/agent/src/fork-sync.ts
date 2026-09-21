// LOCAL FORK ONLY. An anvil fork freezes Perpl's Chainlink Data Streams price at fork time, so after Perpl's max
// price age (60 s) the exchange stops accepting orders. This dev tool impersonates the exchange owner on the fork,
// switches the demo markets to owner-set marks, and mirrors live mainnet marks onto the fork every few seconds.
// `PRICE_SHIFT_<SYMBOL>=<bps>` shifts a market's mark (for example PRICE_SHIFT_BTC=-600 for a 6% drop) to induce
// losses and drawdowns in local testing. Refuses to run against anything but a local RPC.
//
//   pnpm --filter agent fork:sync
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type PublicClient } from "viem";
import { getNetwork } from "@mandate/common";
import { loadNetwork } from "@mandate/common/node";

const local = loadNetwork("local");
if (!/127\.0\.0\.1|localhost/.test(local.rpcUrl)) throw new Error("fork-sync only runs against a local fork");
const live = getNetwork("mainnet", process.env);

const exchangeAbi = parseAbi([
  "function owner() view returns (address)",
  "function setIgnOracle(uint256 perpId, bool ignOracle)",
  "function updateMarkPricePNSByOwner(uint256 perpId, uint32 markPricePNS)",
  "function getPosition(uint256 perpId, uint256 accountId) view returns ((uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,int256,int256,int256), uint256 markPricePNS, bool markPriceValid)",
]);

const forkPub = createPublicClient({ chain: local.chain, transport: http(local.rpcUrl) }) as PublicClient;
const livePub = createPublicClient({ chain: live.chain, transport: http(live.rpcUrl) }) as PublicClient;
const exchange = local.perplExchange;
const owner = (await forkPub.readContract({ address: exchange, abi: exchangeAbi, functionName: "owner" })) as Address;
await forkPub.request({ method: "anvil_impersonateAccount" as never, params: [owner] as never });
await forkPub.request({ method: "anvil_setBalance" as never, params: [owner, "0x56BC75E2D63100000"] as never });
const ownerWallet = createWalletClient({ chain: local.chain, transport: http(local.rpcUrl), account: owner });

for (const m of local.markets) {
  await forkPub.waitForTransactionReceipt({
    hash: await ownerWallet.writeContract({ address: exchange, abi: exchangeAbi, functionName: "setIgnOracle", args: [BigInt(m.perpId), true] }),
  });
}
console.log(`fork-sync: owner ${owner} impersonated; oracle ignored on ${local.markets.map((m) => m.symbol).join(", ")}`);

const intervalMs = Number(process.env.FORK_SYNC_MS || 5000);
async function tick(): Promise<string> {
  const line: string[] = [];
  for (const m of local.markets) {
    const [, liveMark] = await livePub.readContract({ address: live.perplExchange, abi: exchangeAbi, functionName: "getPosition", args: [BigInt(m.perpId), 0n] });
    const shift = Number(process.env[`PRICE_SHIFT_${m.symbol}`] || 0);
    const mark = (liveMark * BigInt(10_000 + shift)) / 10_000n;
    await ownerWallet.writeContract({ address: exchange, abi: exchangeAbi, functionName: "updateMarkPricePNSByOwner", args: [BigInt(m.perpId), Number(mark)] });
    line.push(`${m.symbol} ${Number(mark) / 10 ** m.priceDecimals}${shift ? ` (${shift > 0 ? "+" : ""}${shift / 100}%)` : ""}`);
  }
  return line.join("  ");
}

for (;;) {
  const time = new Date().toISOString().slice(11, 19);
  try {
    console.log(`fork-sync ${time}  ${await tick()}`);
  } catch (err) {
    // Public RPCs drop requests now and then; keep going.
    const msg = err instanceof Error ? (err.message.split("\n")[0] ?? "") : String(err);
    console.log(`fork-sync ${time}  skipped a tick: ${msg}`);
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
