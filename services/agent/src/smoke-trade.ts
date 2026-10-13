// End-to-end smoke test of the /trade flow on Monad testnet, from a brand-new wallet, with the same calls and the
// same default rules the page uses: create the account, write the rules, fund it, open Perpl, buy $50 of BTC, check
// that a $220 buy is refused by the position-size rule, then close. Funds the new wallet from DEPLOYER_PRIVATE_KEY
// with exactly what the judge faucet sends (0.8 MON, 150 AUSD).
//
//   pnpm --filter agent smoke:trade      (testnet only)
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  erc20Abi,
  http,
  keccak256,
  parseEther,
  toBytes,
  type Address,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  allowedMarkets,
  approveCall,
  createAccountCall,
  execOrdersCall,
  lossCooldown,
  mandateAccountAbi,
  mandateAccountFactoryAbi,
  mandateRegistryAbi,
  marketableLimit,
  maxLeverage,
  maxNotional,
  measureBlockTimeMs,
  orderDesc,
  OrderType,
  orderRateLimit,
  pnsToPrice,
  readAccountState,
  readMark,
  slippageWithinCollar,
  usdToCns,
  usdToLots,
} from "@mandate/common";
import { loadNetwork } from "@mandate/common/node";

const net = loadNetwork("testnet");
const dep = net.deployment!;
const btc = net.markets.find((m) => m.symbol === "BTC")!;
const funder = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`);
const user = privateKeyToAccount(generatePrivateKey());
const SELF_SALT = keccak256(toBytes("mandate.self.v1"));
const NO_REPORT = `0x${"0".repeat(64)}` as const;

const transport = http(net.rpcUrl);
const pub = createPublicClient({ chain: net.chain, transport }) as PublicClient;
const walletOf = (a: PrivateKeyAccount) => createWalletClient({ chain: net.chain, transport, account: a });

let ok = true;
const step = (s: string) => console.log(`\n▸ ${s}`);
const pass = (s: string) => console.log(`  PASS ${s}`);
const fail = (s: string) => {
  ok = false;
  console.log(`  FAIL ${s}`);
};

async function send(from: PrivateKeyAccount, req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
  const call = { ...req, account: from } as never;
  await pub.simulateContract(call);
  const gas = ((await pub.estimateContractGas(call)) * 115n) / 100n;
  const hash = await walletOf(from).writeContract({ ...(req as object), account: from, chain: net.chain, gas } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${req.functionName} reverted (${hash})`);
  return { hash, gas };
}

console.log(`Smoke test of /trade on Monad testnet. Fresh wallet ${user.address}`);

step("Fund the fresh wallet like the judge faucet: 0.8 MON and 150 AUSD");
{
  const w = walletOf(funder);
  const h1 = await w.sendTransaction({ account: funder, chain: net.chain, to: user.address, value: parseEther("0.8"), gas: 21_000n });
  await pub.waitForTransactionReceipt({ hash: h1 });
  await send(funder, { address: dep.collateralToken, abi: erc20Abi, functionName: "transfer", args: [user.address, usdToCns(150)] });
  pass(`wallet holds ${Number(await pub.getBalance({ address: user.address })) / 1e18} MON`);
}

step("Create my account (factory.createAccount, owner = operator = the wallet)");
const account = (await pub.readContract({
  address: dep.mandateAccountFactory,
  abi: mandateAccountFactoryAbi,
  functionName: "predictAddress",
  args: [user.address, user.address, SELF_SALT],
})) as Address;
{
  const { hash, gas } = await send(user, { address: dep.mandateAccountFactory, abi: mandateAccountFactoryAbi, functionName: "createAccount", args: [user.address, SELF_SALT] });
  pass(`account ${account} (gas limit ${gas}, tx ${hash})`);
}

step("Write the page's default rules: all markets, 3x, $250 per market, 10 orders per 600 blocks, 15 min cooldown after a $5 loss");
{
  const blockMs = await measureBlockTimeMs(pub, 200n);
  const perps = net.markets.map((m) => m.perpId);
  const rules = [
    allowedMarkets(perps),
    maxLeverage(3),
    ...perps.map((id) => maxNotional(id, usdToCns(250))),
    orderRateLimit(10, 600),
    lossCooldown(usdToCns(5), Math.max(1, Math.round((15 * 60_000) / blockMs))),
  ];
  const { hash } = await send(user, { address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "createMandate", args: [account, rules, NO_REPORT, 0n] });
  pass(`${rules.length} rules written (block time measured ${blockMs.toFixed(0)} ms, tx ${hash})`);
}

step("Open your account with 100 AUSD (transfer, then approve + Perpl createAccount)");
{
  const amount = usdToCns(100);
  await send(user, { address: dep.collateralToken, abi: erc20Abi, functionName: "transfer", args: [account, amount] });
  const { hash } = await send(user, {
    address: account,
    abi: mandateAccountAbi,
    functionName: "execute",
    args: [[approveCall(dep.collateralToken, dep.perplExchange, 2n ** 255n), createAccountCall(dep.perplExchange, amount)]],
  });
  const st = await readAccountState(pub, dep.perplAdapter, account);
  pass(`trading account equity ${Number(st.equity) / 1e6} AUSD (tx ${hash})`);
}

async function order(sizeUsd: number, type: OrderType) {
  const { mark } = await readMark(pub, dep.perplAdapter, account, btc.perpId);
  const st = await readAccountState(pub, dep.perplAdapter, account);
  const pos = st.markets.find((m) => m.marketId === btc.perpId);
  const lots = type === OrderType.CloseLong && pos ? pos.size : usdToLots(btc, sizeUsd, pnsToPrice(btc, mark));
  const isBuy = type === OrderType.OpenLong;
  const desc = orderDesc({
    market: btc,
    type,
    lots,
    limitPricePNS: marketableLimit(mark, isBuy, slippageWithinCollar([], 100)),
    venueLeverage: 3,
    orderDescId: await pub.getBlockNumber(),
  });
  return send(user, { address: account, abi: mandateAccountAbi, functionName: "execute", args: [[execOrdersCall(dep.perplExchange, [desc])]] });
}

step("Buy $50 of BTC");
{
  const before = (await readAccountState(pub, dep.perplAdapter, account)).totalNotional;
  const { hash } = await order(50, OrderType.OpenLong);
  const after = (await readAccountState(pub, dep.perplAdapter, account)).totalNotional;
  if (after > before) pass(`filled on Perpl: $${(Number(after) / 1e6).toFixed(2)} open (tx ${hash})`);
  else fail(`nothing crossed (tx ${hash}); position unchanged`);
}

step("Buy $220 more of BTC: must be refused by the $250 position-size rule");
try {
  await order(220, OrderType.OpenLong);
  fail("the order went through; the rule should have stopped it");
} catch (e) {
  const data = (e as { cause?: { data?: `0x${string}` }; data?: `0x${string}` }).cause?.data ?? (e as { data?: `0x${string}` }).data;
  let name = "";
  try {
    name = data ? decodeErrorResult({ abi: mandateAccountAbi, data }).errorName : "";
  } catch {
    name = "";
  }
  const text = String((e as Error).message);
  if (name === "MandateViolation" || /MandateViolation/.test(text)) pass("refused on-chain with MandateViolation; nothing changed");
  else fail(`refused, but not by a rule: ${name || text.split("\n")[0]}`);
}

step("Close position");
{
  const { hash } = await order(0, OrderType.CloseLong);
  const st = await readAccountState(pub, dep.perplAdapter, account);
  if (st.totalNotional === 0n) pass(`closed (tx ${hash}); equity ${(Number(st.equity) / 1e6).toFixed(2)} AUSD`);
  else fail(`still $${Number(st.totalNotional) / 1e6} open after close (tx ${hash})`);
}

console.log(`\n${ok ? "SMOKE TEST PASSED" : "SMOKE TEST FAILED"}  ·  wallet ${user.address}  ·  account ${account}`);
process.exit(ok ? 0 : 1);
