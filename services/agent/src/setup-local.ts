// Local demo setup against an anvil fork of Monad mainnet (real Perpl): underwrite with Nansen (or sample data),
// create a MandateAccount, attach the mandate with its report hash, fund it with AUSD, set the agent's session key and
// open the Perpl account. Prints the env for `pnpm --filter agent start`.
//
//   anvil --fork-url https://rpc.monad.xyz --block-time 1
//   DEPLOYMENT_NAME=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil #0>
//   pnpm --filter agent setup:local
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, toBytes, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mandateAccountFactoryAbi, mandateAccountAbi, mandateRegistryAbi, bondVaultAbi, RuleKind, toAbiRule, approveCall, createAccountCall, usdToCns, type MarketSymbol } from "@mandate/common";
import { loadNetwork } from "@mandate/common/node";
import { NansenClient, fixtureClient, underwrite, canonicalJson } from "underwriter";
import { DATA_DIR } from "./config.ts";

// Well-known anvil dev keys (never used outside a local fork).
const ANVIL_KEYS = {
  backer: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  agent: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  operator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
} as const;

const net = loadNetwork("local");
const dep = net.deployment;
if (!dep) throw new Error("No local deployment: run the deploy script with DEPLOYMENT_NAME=local first");

const fundUsd = Number(process.env.FUND_USD || 100);
const baseNotionalUsd = Number(process.env.BASE_NOTIONAL_USD || fundUsd * 2);
const symbols = (process.env.MARKETS || "BTC,ETH").split(",") as MarketSymbol[];
const disputeWindowBlocks = BigInt(process.env.DISPUTE_WINDOW_BLOCKS || 600);
const drawdownPct = process.env.DRAWDOWN_PCT ? Number(process.env.DRAWDOWN_PCT) : undefined;
const bondUsd = Number(process.env.BOND_USD || 0);

const backer = privateKeyToAccount(ANVIL_KEYS.backer);
const agent = privateKeyToAccount(ANVIL_KEYS.agent);
const operator = privateKeyToAccount(ANVIL_KEYS.operator);
const transport = http(net.rpcUrl);
const pub = createPublicClient({ chain: net.chain, transport }) as PublicClient;
const wallet = createWalletClient({ chain: net.chain, transport, account: backer });

// 1. Underwrite.
const live = Boolean(process.env.NANSEN_API_KEY);
const { report, reportHash, rules } = await underwrite({
  nansen: live ? new NansenClient(process.env.NANSEN_API_KEY!) : fixtureClient(),
  net,
  symbols,
  baseNotionalUsd,
  source: live ? "nansen" : "fixture",
});
mkdirSync(join(DATA_DIR, "reports"), { recursive: true });
const reportJson = canonicalJson(report);
if (keccak256(toBytes(reportJson)) !== reportHash) throw new Error("report hash mismatch");
writeFileSync(join(DATA_DIR, "reports", `${reportHash}.json`), reportJson);
console.log(`Underwriting (${report.source}): ${report.mandateRegime}. Report ${reportHash}`);
for (const p of report.proposal) console.log(`  ${p.label}: ${p.limit}`);


// Optional demo overrides: a tighter drawdown limit and a shorter dispute window make a breach reachable quickly.
const demoRules = rules.map((r) =>
  drawdownPct !== undefined && r.kind === RuleKind.MaxDrawdown ? { ...r, p1: BigInt(Math.round(drawdownPct * 100)) } : r,
);

// 2. Account.
const salt = keccak256(toBytes(`demo-${Date.now()}`));
const predicted = await pub.readContract({
  address: dep.mandateAccountFactory,
  abi: mandateAccountFactoryAbi,
  functionName: "predictAddress",
  args: [backer.address, operator.address, salt],
});
const send = async (hash: `0x${string}`) => {
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx ${hash} reverted`);
  return r;
};
await send(await wallet.writeContract({ address: dep.mandateAccountFactory, abi: mandateAccountFactoryAbi, functionName: "createAccount", args: [operator.address, salt] }));
const account = predicted as Address;
console.log(`MandateAccount ${account}`);

// 3. Mandate with the report hash (dispute window 600 blocks).
await send(
  await wallet.writeContract({
    address: dep.mandateRegistry,
    abi: mandateRegistryAbi,
    functionName: "createMandate",
    args: [account, demoRules.map(toAbiRule), reportHash, disputeWindowBlocks],
  }),
);

// 4. Fund with AUSD. On the fork, borrow it from the exchange (a large AUSD holder), as the fork tests do.
await pub.request({ method: "anvil_impersonateAccount" as never, params: [dep.perplExchange] as never });
await pub.request({ method: "anvil_setBalance" as never, params: [dep.perplExchange, "0x56BC75E2D63100000"] as never });
const whale = createWalletClient({ chain: net.chain, transport, account: dep.perplExchange });
await send(
  await whale.writeContract({
    address: dep.collateralToken,
    abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
    functionName: "transfer",
    args: [account, usdToCns(fundUsd)],
  }),
);
await pub.request({ method: "anvil_stopImpersonatingAccount" as never, params: [dep.perplExchange] as never });

// 5. Session key for the agent, then open the Perpl account (owner call).
const head = await pub.getBlockNumber();
await send(await wallet.writeContract({ address: account, abi: mandateAccountAbi, functionName: "setSessionKey", args: [agent.address, head + 10_000_000n] }));
await send(
  await wallet.writeContract({
    address: account,
    abi: mandateAccountAbi,
    functionName: "execute",
    args: [[approveCall(dep.collateralToken, dep.perplExchange, 2n ** 255n), createAccountCall(dep.perplExchange, usdToCns(fundUsd))]],
  }),
);

// 6. Optional operator bond, so a breach can actually pay the backer (BOND_USD).
if (bondUsd > 0) {
  const bond = usdToCns(bondUsd);
  await pub.request({ method: "anvil_impersonateAccount" as never, params: [dep.perplExchange] as never });
  const whale2 = createWalletClient({ chain: net.chain, transport, account: dep.perplExchange });
  await send(
    await whale2.writeContract({
      address: dep.collateralToken,
      abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
      functionName: "transfer",
      args: [operator.address, bond],
    }),
  );
  await pub.request({ method: "anvil_stopImpersonatingAccount" as never, params: [dep.perplExchange] as never });

  const opWallet = createWalletClient({ chain: net.chain, transport, account: operator });
  await send(
    await opWallet.writeContract({
      address: dep.collateralToken,
      abi: parseAbi(["function approve(address,uint256) returns (bool)"]),
      functionName: "approve",
      args: [dep.bondVault, bond],
    }),
  );
  await send(
    await opWallet.writeContract({ address: dep.bondVault, abi: bondVaultAbi, functionName: "postBond", args: [account, bond] }),
  );
  console.log(`Bond posted: ${bondUsd} AUSD by operator ${operator.address}`);
}

console.log(`\nReady. Run the agent with:\n`);
console.log(`NETWORK=local MANDATE_ACCOUNT=${account} AGENT_SESSION_PRIVATE_KEY=${ANVIL_KEYS.agent} DEMO_MODE=1 AGENT_LOOP_BLOCKS=5 pnpm --filter agent start`);
writeFileSync(join(DATA_DIR, "local-demo.json"), JSON.stringify({ account, backer: backer.address, operator: operator.address, agent: agent.address, reportHash }, null, 2));
