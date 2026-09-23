// Fallback keeper (PRD 10.2): the same checks as the CRE workflow, run as a plain Node process.
// It watches every mandate account, flags market-rule breaches, slashes after the dispute window, and keeps the
// drawdown peak current. Every round is logged for the benchmarks (blocks from breach to flag, rejected flags).
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, isAddress, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { measureBlockTimeMs, type NetworkKey } from "@mandate/common";
import { loadNetwork } from "@mandate/common/node";
import { actOnAccount, checkAccount, discoverAccounts, type AccountCheck, type KeeperAction } from "./keeper.ts";

const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../data/keeper-logs");

const net = loadNetwork((process.env.NETWORK as NetworkKey) || "testnet");
const dep = net.deployment;
if (!dep) throw new Error(`No deployment for ${net.key}`);
const key = process.env.KEEPER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("KEEPER_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) is not set");

const signer = privateKeyToAccount(key as `0x${string}`);
const transport = http(net.rpcUrl);
const pub = createPublicClient({ chain: net.chain, transport }) as PublicClient;
const wallet = createWalletClient({ chain: net.chain, transport, account: signer });

const intervalMs = Number(process.env.KEEPER_INTERVAL_MS || 2_000);
const fixed = (process.env.KEEPER_ACCOUNTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s): s is Address => isAddress(s));
const logPath = join(LOG_DIR, `${net.key}.jsonl`);

/** First block at which each account's breach became visible, for the blocks-to-flag benchmark. */
const firstSeenBreach = new Map<string, bigint>();

function log(entry: Record<string, unknown>) {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), network: net.key, ...entry }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n`);
}

function describe(check: AccountCheck, action: KeeperAction): string | undefined {
  const s = check.statuses.find((x) => x.breached) ?? check.statuses[0];
  const dd = s ? `drawdown ${(s.drawdownBps / 100).toFixed(2)}% / ${(s.limitBps / 100).toFixed(2)}%` : "no market rule";
  switch (action.kind) {
    case "flagged": {
      const seen = firstSeenBreach.get(check.account);
      const blocks = seen === undefined ? 0n : action.blockNumber - seen;
      return `FLAGGED ${check.account} (${dd}) in ${blocks} blocks · ${action.txHash}`;
    }
    case "flag-rejected":
      return `held back on ${check.account} (${dd}): ${action.reason}`;
    case "slashed":
      return `SLASHED breach ${action.breachId} on ${check.account} · ${action.txHash}`;
    case "poked":
      return `peak updated on ${check.account} · ${action.txHash}`;
    case "error":
      return `error on ${check.account}: ${action.reason}`;
    default:
      return undefined;
  }
}

async function round(accounts: Address[]) {
  for (const account of accounts) {
    try {
      const check = await checkAccount(pub, dep!, account);
      const breached = check.statuses.some((s) => s.breached);
      if (breached && !firstSeenBreach.has(account)) firstSeenBreach.set(account, check.block);
      if (!breached) firstSeenBreach.delete(account);

      const action = await actOnAccount(pub, wallet, signer, dep!, check, { poke: true, slash: true });
      const blocksToFlag =
        action.kind === "flagged" ? Number(action.blockNumber - (firstSeenBreach.get(account) ?? action.blockNumber)) : undefined;
      log({ account, block: check.block, statuses: check.statuses, marksTrusted: check.marksTrusted, action, blocksToFlag });
      const line = describe(check, action);
      if (line) console.log(`[block ${check.block}] ${line}`);
      if (action.kind === "flagged") firstSeenBreach.delete(account);
    } catch (err) {
      const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
      log({ account, action: { kind: "error", reason } });
      console.log(`error on ${account}: ${reason}`);
    }
  }
}

const blockMs = await measureBlockTimeMs(pub, 200n).catch(() => NaN);
let accounts = fixed.length ? fixed : await discoverAccounts(pub, dep);
console.log(`Mandate keeper (relayer) · ${net.key} · signer ${signer.address}`);
console.log(`Block time ~${Number.isFinite(blockMs) ? blockMs.toFixed(0) : "?"} ms; checking every ${intervalMs} ms.`);
console.log(`Watching ${accounts.length} account(s): ${accounts.join(", ") || "none yet"}`);
console.log(`Log: ${logPath}`);

let stop = false;
process.on("SIGINT", () => {
  stop = true;
});

const maxRounds = process.env.KEEPER_MAX_ROUNDS ? Number(process.env.KEEPER_MAX_ROUNDS) : Infinity;
for (let i = 0; i < maxRounds && !stop; i++) {
  if (!fixed.length && i > 0 && i % 30 === 0) accounts = await discoverAccounts(pub, dep); // pick up new mandates
  await round(accounts);
  if (!stop) await new Promise((r) => setTimeout(r, intervalMs));
}
