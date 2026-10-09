// Stages a genuine drawdown breach on testnet so the CRE keeper has something real to flag (docs/cre-simulation.md).
// Every step is a transaction the app can perform: create an account and mandate, fund it, open a small long, and , 
// as the backer, which is their right, tighten the drawdown floor below the drawdown that already happened.
// Nothing here flags the breach; the CRE workflow does.
//
//   pnpm --filter agent stage:breach      (testnet only; uses DEPLOYER_PRIVATE_KEY as backer)
import { createPublicClient, createWalletClient, erc20Abi, http, keccak256, toBytes, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  allowedMarkets,
  approveCall,
  cnsToUsd,
  createAccountCall,
  drawdownBps,
  execOrdersCall,
  isDrawdownBreached,
  mandateAccountAbi,
  mandateAccountFactoryAbi,
  mandateRegistryAbi,
  marketableLimit,
  maxDrawdown,
  maxLeverage,
  maxNotional,
  oracleGuardAbi,
  orderDesc,
  perplExchangeAbi,
  pnsToPrice,
  readAccountState,
  readMark,
  usdToCns,
  usdToLots,
  OrderType,
  RuleKind,
} from "@mandate/common";
import { loadNetwork } from "@mandate/common/node";

const SALT = keccak256(toBytes("mandate.cre-demo.v1"));
const NO_REPORT = `0x${"0".repeat(64)}` as Hex;
const DRAWDOWN_INDEX = 3n;

const net = loadNetwork("testnet"); // never mainnet: this deliberately creates a loss-making breach
const dep = net.deployment!;
const owner = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY as Hex);
const pub = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) }) as PublicClient;
const wallet = createWalletClient({ chain: net.chain, transport: http(net.rpcUrl), account: owner });
const btc = net.markets.find((m) => m.symbol === "BTC")!;

async function send(req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
  const call = { ...req, account: owner } as never;
  await pub.simulateContract(call);
  const gas = ((await pub.estimateContractGas(call)) * 115n) / 100n;
  const hash = await wallet.writeContract({ ...(req as object), account: owner, chain: net.chain, gas } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return hash;
}

const account = (await pub.readContract({
  address: dep.mandateAccountFactory,
  abi: mandateAccountFactoryAbi,
  functionName: "predictAddress",
  args: [owner.address, owner.address, SALT],
})) as Address;
console.log(`account: ${account}`);

const code = await pub.getCode({ address: account });
if (!code || code === "0x") {
  console.log("create:", await send({ address: dep.mandateAccountFactory, abi: mandateAccountFactoryAbi, functionName: "createAccount", args: [owner.address, SALT] }));
  const rules = [allowedMarkets([btc.perpId]), maxLeverage(3), maxNotional(btc.perpId, usdToCns(250)), maxDrawdown(0.5)];
  console.log("mandate:", await send({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "createMandate", args: [account, rules, NO_REPORT, 20n] }));
}
const mandateId = (await pub.readContract({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "mandateIdOf", args: [account] })) as bigint;
console.log(`mandate id: ${mandateId}`);

let state = await readAccountState(pub, dep.perplAdapter, account);
let venueExists = false;
try {
  const info = (await pub.readContract({ address: dep.perplExchange, abi: perplExchangeAbi, functionName: "getAccountByAddr", args: [account] })) as { accountId: bigint };
  venueExists = info.accountId !== 0n;
} catch {
  venueExists = false;
}
console.log(`perpl account exists: ${venueExists} · idle equity $${cnsToUsd(state.equity).toFixed(2)}`);
if (!venueExists) {
  // Perpl's getMinAccountOpenCNS(): 100 AUSD on testnet (10 on mainnet).
  const amount = usdToCns(100);
  const idle = (await pub.readContract({ address: dep.collateralToken, abi: erc20Abi, functionName: "balanceOf", args: [account] })) as bigint;
  if (idle < amount) console.log("transfer:", await send({ address: dep.collateralToken, abi: erc20Abi, functionName: "transfer", args: [account, amount - idle] }));
  console.log("open perpl:", await send({
    address: account,
    abi: mandateAccountAbi,
    functionName: "execute",
    args: [[approveCall(dep.collateralToken, dep.perplExchange, 2n ** 255n), createAccountCall(dep.perplExchange, amount)]],
  }));
  state = await readAccountState(pub, dep.perplAdapter, account);
}

if (state.totalNotional === 0n) {
  const { mark } = await readMark(pub, dep.perplAdapter, account, btc.perpId);
  const lots = usdToLots(btc, 40, pnsToPrice(btc, mark));
  const desc = orderDesc({ market: btc, type: OrderType.OpenLong, lots, limitPricePNS: marketableLimit(mark, true), venueLeverage: 3, orderDescId: await pub.getBlockNumber() });
  console.log("open long:", await send({ address: account, abi: mandateAccountAbi, functionName: "execute", args: [[execOrdersCall(dep.perplExchange, [desc])]] }));
  state = await readAccountState(pub, dep.perplAdapter, account);
}

const monitor = (await pub.readContract({ address: account, abi: mandateAccountAbi, functionName: "monitor", args: [DRAWDOWN_INDEX] })) as { w0: bigint };
const peak = monitor.w0;
const dd = drawdownBps(peak, state.equity);
console.log(`equity $${cnsToUsd(state.equity).toFixed(6)} · peak $${cnsToUsd(peak).toFixed(6)} · drawdown ${dd} bps · open $${cnsToUsd(state.totalNotional).toFixed(2)}`);

// Tighten the floor below the drawdown that already happened: the backer's own right, and a real breach.
// The same shared math both keepers and MaxDrawdownRule use: would a 1 bps floor be broken right now?
if (isDrawdownBreached(peak, state.equity, 1n)) {
  const [, , rules] = (await pub.readContract({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "rulesOf", args: [account] })) as readonly [boolean, boolean, readonly { kind: number; p1: bigint }[]];
  if (rules[Number(DRAWDOWN_INDEX)]!.kind !== RuleKind.MaxDrawdown) throw new Error("rule 3 is not the drawdown rule");
  if (rules[Number(DRAWDOWN_INDEX)]!.p1 > 1n) {
    console.log("tighten to 0.01%:", await send({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "tightenRule", args: [mandateId, DRAWDOWN_INDEX, { kind: RuleKind.MaxDrawdown, p1: 1n, p2: 0n, p3: 0n }] }));
  }
  console.log(`breached now: ${isDrawdownBreached(peak, state.equity, 1n)}`);
} else {
  console.log("drawdown not past 1 bps yet; wait for the market to move against the long and rerun");
}
console.log(`marks trusted by OracleGuard: ${await pub.readContract({ address: dep.oracleGuard, abi: oracleGuardAbi, functionName: "accountMarksTrusted", args: [account] })}`);
