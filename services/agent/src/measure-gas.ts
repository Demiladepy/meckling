// Measures gas per enforced trade on Monad testnet with eth_estimateGas, i.e. under Monad's own pricing (MIP-8 storage
// pages included). The same $20 BTC IOC long, limit 0.5% through the mark, sent four ways:
//
//   raw      from an EOA straight to Perpl (no Mandate)
//   old-4    through the Sep 23 self-mandate account on the previous contracts (4 rules, storage in mappings)
//   new-4    through a twin account with the same 4 rules on the current contracts (MIP-8 page layout)
//   live-8   through the live agent's account with its session key (Nansen's 7 rules + price protection)
//
// old-4 vs new-4 isolates the storage-layout change. Creating the twin is the only state this script writes.
//
//   MANDATE_ACCOUNT=0x… pnpm --filter agent measure:gas      (testnet only)
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, keccak256, toBytes, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  allowedMarkets,
  approveCall,
  createAccountCall,
  execOrdersCall,
  mandateAccountAbi,
  mandateAccountFactoryAbi,
  mandateRegistryAbi,
  marketableLimit,
  maxLeverage,
  maxNotional,
  orderDesc,
  OrderType,
  perplExchangeAbi,
  pnsToPrice,
  readMark,
  RuleKind,
  usdToCns,
  usdToLots,
} from "@mandate/common";
import { loadNetwork } from "@mandate/common/node";

const OLD_SELF_ACCOUNT = "0xB81b1d54a76170dD0c5c4306f5f0437329afA53F" as Address; // previous contracts, 4 rules
const TWIN_SALT = keccak256(toBytes("mandate.gas.twin.v1"));
const NO_REPORT = `0x${"0".repeat(64)}` as const;

const net = loadNetwork("testnet");
const dep = net.deployment!;
const btc = net.markets.find((m) => m.symbol === "BTC")!;
const owner = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
const agent = privateKeyToAccount(process.env.AGENT_SESSION_PRIVATE_KEY as `0x${string}`);
const live = process.env.MANDATE_ACCOUNT as Address | undefined;

const transport = http(net.rpcUrl);
const pub = createPublicClient({ chain: net.chain, transport }) as PublicClient;
const wallet = createWalletClient({ chain: net.chain, transport, account: owner });

async function send(req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
  const call = { ...req, account: owner } as never;
  await pub.simulateContract(call);
  const gas = ((await pub.estimateContractGas(call)) * 115n) / 100n;
  const hash = await wallet.writeContract({ ...(req as object), account: owner, chain: net.chain, gas } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${req.functionName} reverted (${hash})`);
  return hash;
}

// The twin: same rules as the old self-mandate account (allowed BTC, 3x, $250 BTC, 10 orders per 600 blocks).
const twin = (await pub.readContract({
  address: dep.mandateAccountFactory,
  abi: mandateAccountFactoryAbi,
  functionName: "predictAddress",
  args: [owner.address, owner.address, TWIN_SALT],
})) as Address;
const code = await pub.getCode({ address: twin });
if (!code || code === "0x") {
  console.log(`creating twin ${twin}`);
  await send({ address: dep.mandateAccountFactory, abi: mandateAccountFactoryAbi, functionName: "createAccount", args: [owner.address, TWIN_SALT] });
  const rateLimit = { kind: RuleKind.OrderRateLimit, p1: 10n, p2: 600n, p3: 0n };
  const rules = [allowedMarkets([btc.perpId]), maxLeverage(3), maxNotional(btc.perpId, usdToCns(250)), rateLimit];
  await send({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "createMandate", args: [twin, rules, NO_REPORT, 0n] });
  const amount = usdToCns(100); // Perpl's minimum to open an account on testnet
  await send({ address: dep.collateralToken, abi: erc20Abi, functionName: "transfer", args: [twin, amount] });
  await send({
    address: twin,
    abi: mandateAccountAbi,
    functionName: "execute",
    args: [[approveCall(dep.collateralToken, dep.perplExchange, 2n ** 255n), createAccountCall(dep.perplExchange, amount)]],
  });
}

const { mark } = await readMark(pub, dep.perplAdapter, twin, btc.perpId);
const lots = usdToLots(btc, 20, pnsToPrice(btc, mark));
const order = () =>
  orderDesc({ market: btc, type: OrderType.OpenLong, lots, limitPricePNS: marketableLimit(mark, true, 50), venueLeverage: 3, orderDescId: 1n });
const tradeVia = (account: Address) => ({
  address: account,
  abi: mandateAccountAbi,
  functionName: "execute",
  args: [[execOrdersCall(dep.perplExchange, [order()])]],
});

const raw = await pub.estimateGas({
    account: owner,
    to: dep.perplExchange,
    data: encodeFunctionData({ abi: perplExchangeAbi, functionName: "execOrders", args: [[order()], true] }),
});
const old4 = await pub.estimateContractGas({ ...tradeVia(OLD_SELF_ACCOUNT), account: owner } as never);
const new4 = await pub.estimateContractGas({ ...tradeVia(twin), account: owner } as never);
const rows: [string, bigint][] = [
  ["raw: EOA straight to Perpl", raw],
  ["old-4: previous contracts, 4 rules", old4],
  ["new-4: current contracts, same 4 rules", new4],
];
if (live) rows.push(["live-8: live agent, 8 rules, session key", await pub.estimateContractGas({ ...tradeVia(live), account: agent } as never)]);

console.log(`\nMonad testnet, block ${await pub.getBlockNumber()}, $20 BTC IOC long, limit mark + 0.5%`);
for (const [label, gas] of rows) {
  const over = gas - raw;
  console.log(`${label.padEnd(44)} ${gas.toString().padStart(9)}${gas === raw ? "" : `   +${over} (+${((Number(over) / Number(raw)) * 100).toFixed(1)}%)`}`);
}
console.log(`\nstorage layout (old-4 minus new-4): ${old4 - new4} gas`);
