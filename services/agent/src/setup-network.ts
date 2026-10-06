// Sets up a live mandate on testnet or mainnet from the backer's key: live Nansen underwriting, a MandateAccount,
// the mandate with its report hash, the agent's session key, funding, and the Perpl account.
// Nothing here is a cheat or a shim: every step is a real transaction the app performs too.
//
//   NETWORK=testnet FUND_USD=200 pnpm --filter agent setup:network
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  toBytes,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  approveCall,
  createAccountCall,
  mandateAccountAbi,
  mandateAccountFactoryAbi,
  mandateRegistryAbi,
  measureBlockTimeMs,
  priceCollar,
  RuleKind,
  bondVaultAbi,
  toAbiRule,
  usdToCns,
  type MarketSymbol,
  type NetworkKey,
} from "@mandate/common";
import { loadNetwork } from "@mandate/common/node";
import { NansenClient, canonicalJson, fixtureClient, underwrite } from "underwriter";
import { DATA_DIR } from "./config.ts";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
const netKey = (process.env.NETWORK as NetworkKey) || "testnet";
if (netKey === "local") throw new Error("Use setup:local for the anvil fork");
const net = loadNetwork(netKey);
const dep = net.deployment;
if (!dep) throw new Error(`No deployment for ${netKey}: run contracts/script/Deploy.s.sol first`);

const backer = privateKeyToAccount(key as `0x${string}`);
const agentSessionKey = (process.env.AGENT_SESSION_ADDRESS ?? "") as Address;
if (!agentSessionKey) throw new Error("AGENT_SESSION_ADDRESS is not set");
const operator = (process.env.AGENT_OPERATOR_ADDRESS ?? backer.address) as Address;

const fundUsd = Number(process.env.FUND_USD || 200);
const baseNotionalUsd = Number(process.env.BASE_NOTIONAL_USD || fundUsd * 2);
const symbols = (process.env.MARKETS || "BTC,ETH").split(",") as MarketSymbol[];
const disputeWindowBlocks = BigInt(process.env.DISPUTE_WINDOW_BLOCKS || 600);
const drawdownPct = process.env.DRAWDOWN_PCT ? Number(process.env.DRAWDOWN_PCT) : undefined;
const bondUsd = Number(process.env.BOND_USD || 0);
// Optional price protection (D14): the backer's choice, like in the app. Not part of Nansen's proposal.
const collarPct = process.env.PRICE_COLLAR_PCT ? Number(process.env.PRICE_COLLAR_PCT) : undefined;

const transport = http(net.rpcUrl);
const pub = createPublicClient({ chain: net.chain, transport }) as PublicClient;
const wallet = createWalletClient({ chain: net.chain, transport, account: backer });
const erc20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

/** Simulate, then send with gas = estimate + 15% (Monad charges the limit, not the usage). */
async function send(req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) {
  const call = { ...req, account: backer } as never;
  await pub.simulateContract(call);
  const gas = ((await pub.estimateContractGas(call)) * 115n) / 100n;
  const hash = await wallet.writeContract({ ...(req as object), account: backer, chain: net.chain, gas } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${req.functionName} reverted (${hash})`);
  console.log(`  ${req.functionName}: ${hash}`);
  return receipt;
}

const blockMs = await measureBlockTimeMs(pub, 200n);
const mon = await pub.getBalance({ address: backer.address });
const ausd = await pub.readContract({ address: dep.collateralToken, abi: erc20, functionName: "balanceOf", args: [backer.address] });
console.log(`${netKey} · block ${await pub.getBlockNumber()} · ~${blockMs.toFixed(0)} ms/block`);
console.log(`backer ${backer.address}: ${(Number(mon) / 1e18).toFixed(3)} MON, ${(Number(ausd) / 1e6).toFixed(2)} AUSD`);
if (ausd < usdToCns(fundUsd)) throw new Error(`Backer holds less than the ${fundUsd} AUSD it is about to fund`);

// 1. Underwrite with live Nansen data.
const live = Boolean(process.env.NANSEN_API_KEY);
const { report, reportHash, rules } = await underwrite({
  nansen: live ? new NansenClient(process.env.NANSEN_API_KEY!) : fixtureClient(),
  net,
  symbols,
  baseNotionalUsd,
  source: live ? "nansen" : "fixture",
});
mkdirSync(join(DATA_DIR, "reports"), { recursive: true });
writeFileSync(join(DATA_DIR, "reports", `${reportHash}.json`), canonicalJson(report));
console.log(`\nUnderwriting (${report.source}): ${report.mandateRegime}, report ${reportHash}`);
for (const m of report.markets) for (const r of m.reasons) console.log(`  ${m.symbol}: ${r}`);
for (const p of report.proposal) console.log(`  ${p.label}: ${p.limit}`);


// Optional demo overrides: a tighter drawdown limit and a shorter dispute window make a breach reachable quickly.
const demoRules = rules.map((r) =>
  drawdownPct !== undefined && r.kind === RuleKind.MaxDrawdown ? { ...r, p1: BigInt(Math.round(drawdownPct * 100)) } : r,
);
if (collarPct !== undefined) demoRules.push(priceCollar(collarPct));

// 2. MandateAccount.
console.log("\nTransactions:");
const salt = keccak256(toBytes(`${reportHash}:${Date.now()}`));
const account = (await pub.readContract({
  address: dep.mandateAccountFactory,
  abi: mandateAccountFactoryAbi,
  functionName: "predictAddress",
  args: [backer.address, operator, salt],
})) as Address;
await send({ address: dep.mandateAccountFactory, abi: mandateAccountFactoryAbi, functionName: "createAccount", args: [operator, salt] });

// 3. Mandate with the report hash, and the agent's session key.
await send({
  address: dep.mandateRegistry,
  abi: mandateRegistryAbi,
  functionName: "createMandate",
  args: [account, demoRules.map(toAbiRule), reportHash, disputeWindowBlocks],
});
const head = await pub.getBlockNumber();
await send({ address: account, abi: mandateAccountAbi, functionName: "setSessionKey", args: [agentSessionKey, head + 8_640_000n] });

// 4. Fund it and open the Perpl account.
const amount = usdToCns(fundUsd);
await send({ address: dep.collateralToken, abi: erc20, functionName: "transfer", args: [account, amount] });
await send({
  address: account,
  abi: mandateAccountAbi,
  functionName: "execute",
  args: [[approveCall(dep.collateralToken, dep.perplExchange, 2n ** 255n), createAccountCall(dep.perplExchange, amount)]],
});

// 5. Optional operator bond, so a breach can actually pay the backer.
if (bondUsd > 0) {
  const bond = usdToCns(bondUsd);
  await send({ address: dep.collateralToken, abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [dep.bondVault, bond] });
  await send({ address: dep.bondVault, abi: bondVaultAbi, functionName: "postBond", args: [account, bond] });
  console.log(`Bond posted: ${bondUsd} AUSD`);
}

writeFileSync(join(DATA_DIR, `${netKey}-demo.json`), JSON.stringify({ network: netKey, account, backer: backer.address, operator, sessionKey: agentSessionKey, reportHash, fundUsd }, null, 2));
console.log(`\nMandateAccount ${account} funded with ${fundUsd} AUSD.`);
console.log(`\nRun the agent:\n  NETWORK=${netKey} MANDATE_ACCOUNT=${account} DEMO_MODE=1 AGENT_LOOP_BLOCKS=60 pnpm --filter agent start`);
console.log(`Watch it:\n  NETWORK=${netKey} pnpm --filter app dev  →  http://localhost:3000/agents/${account}`);
