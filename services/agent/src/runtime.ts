// Agent runtime (PRD section 8). Holds a session key for one MandateAccount; every N blocks it reads the account, the
// mandate and Nansen signals, asks its provider for one decision, and submits it through MandateAccount.execute.
// It never holds user funds and never has a key that can withdraw.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, createWalletClient, http, type Account, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import {
  OrderType,
  RULE_NAMES,
  RuleKind,
  cnsToUsd,
  decodeViolation,
  describeLimit,
  execOrdersCall,
  executeTight,
  mandateAccountAbi,
  marketBySymbol,
  marketableLimit,
  notionalCns,
  orderDesc,
  pnsToPrice,
  preflightTight,
  readAccountState,
  readMark,
  readMonitors,
  readRules,
  revertData,
  shortError,
  usdToLots,
  violationMessage,
  type AccountState,
  type MarketSymbol,
  type NetworkConfig,
  type Rule,
} from "@mandate/common";
import type { Decision, DecisionContext, DecisionProvider } from "./decision.ts";

export interface AgentConfig {
  net: NetworkConfig;
  mandateAccount: Address;
  sessionKey: Account;
  provider: DecisionProvider;
  loopBlocks: number;
  logPath: string;
  /** Demo mode: preflight every open so blocked attempts are recorded on-chain, and send the reverting execute. */
  demo: boolean;
  /** Per-position margin leverage on Perpl. Proven at 15x on the mainnet fork. */
  venueLeverage: number;
  slippageBps: number;
  signals: (markets: MarketSymbol[]) => Promise<Record<string, string[]>>;
}

export interface LogRecord {
  ts: string;
  block: string;
  account: Address;
  provider: string;
  intent: Pick<Decision, "action" | "market" | "size_usd">;
  reasoning: string;
  proposedOrder?: { market: MarketSymbol; side: "long" | "short" | "close"; lots: string; limitPrice: number; notionalUsd: number; leverageAfter: number };
  result: "filled" | "blocked" | "held" | "error";
  resultBlock?: string;
  txHash?: Hex;
  preflightTxHash?: Hex;
  violation?: { ruleIndex: number; rule: string; observed: string; limit: string; message: string };
  error?: string;
  gasUsed?: string;
}

/** A reverting execute costs gas on Monad (charged on the limit), so demo sends use this fixed, tight limit. */
const DEMO_REVERT_GAS = 1_500_000n;

export class AgentRuntime {
  readonly pub: PublicClient;
  readonly wallet: WalletClient;
  private readonly cfg: AgentConfig;
  private history: { block: string; intent: string; result: string }[] = [];
  private stopped = false;

  constructor(cfg: AgentConfig) {
    this.cfg = cfg;
    this.pub = createPublicClient({ chain: cfg.net.chain, transport: http(cfg.net.rpcUrl) }) as PublicClient;
    this.wallet = createWalletClient({ chain: cfg.net.chain, transport: http(cfg.net.rpcUrl), account: cfg.sessionKey });
  }

  private get dep() {
    const d = this.cfg.net.deployment;
    if (!d) throw new Error(`No deployment for ${this.cfg.net.key}; run contracts/script/Deploy.s.sol first`);
    return d;
  }

  stop() {
    this.stopped = true;
  }

  async run(maxRounds = Infinity) {
    const isKey = await this.pub.readContract({
      address: this.cfg.mandateAccount,
      abi: mandateAccountAbi,
      functionName: "isSessionKey",
      args: [this.cfg.sessionKey.address],
    });
    if (!isKey) throw new Error(`${this.cfg.sessionKey.address} is not a live session key for ${this.cfg.mandateAccount}`);

    let rounds = 0;
    let next = await this.pub.getBlockNumber();
    while (!this.stopped && rounds < maxRounds) {
      const block = await this.pub.getBlockNumber();
      if (block < next) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      await this.round();
      rounds++;
      next = (await this.pub.getBlockNumber()) + BigInt(this.cfg.loopBlocks);
    }
  }

  /** One decision, submitted and logged. */
  async round(): Promise<LogRecord> {
    const { rules } = await readRules(this.pub, this.dep.mandateRegistry, this.cfg.mandateAccount);
    const state = await readAccountState(this.pub, this.dep.perplAdapter, this.cfg.mandateAccount);
    const ctx = await this.context(rules, state);
    let decision: Decision;
    try {
      decision = await this.cfg.provider.decide(ctx);
    } catch (err) {
      decision = { action: "hold", market: "BTC", size_usd: 0, reasoning: `Decision failed (${err instanceof Error ? err.message : String(err)}). Holding.` };
    }
    const rec = await this.submit(decision, rules, state, ctx.block);
    this.log(rec);
    const intent = decision.action === "hold" ? "hold" : `${decision.action} ${decision.market} $${decision.size_usd}`;
    this.history = [...this.history, { block: rec.block, intent, result: rec.violation ? `blocked: ${rec.violation.message}` : rec.result }].slice(-6);
    return rec;
  }

  private async context(rules: Rule[], state: AccountState): Promise<DecisionContext> {
    const net = this.cfg.net;
    const block = await this.pub.getBlockNumber();
    const allowedRule = rules.find((r) => r.kind === RuleKind.AllowedMarkets);
    const tradable = net.markets.filter((m) => !allowedRule || (allowedRule.p1 >> BigInt(m.perpId)) & 1n);
    const marks: Record<string, number> = {};
    await Promise.all(
      tradable.map(async (m) => {
        const { mark } = await readMark(this.pub, this.dep.perplAdapter, this.cfg.mandateAccount, m.perpId);
        marks[m.symbol] = pnsToPrice(m, mark);
      }),
    );
    const monitors = await readMonitors(this.pub, this.cfg.mandateAccount, rules.length);
    const equityUsd = cnsToUsd(state.equity);
    const levNow = state.equity > 0n ? Number((state.totalNotional * 10_000n) / state.equity) / 10_000 : 0;

    let cooldownBlocksLeft = 0;
    const limits = rules.map((r, i) => {
      const base = `${RULE_NAMES[r.kind]}: ${describeLimit(r, net)}`;
      if (r.kind === RuleKind.MaxLeverage) return `${base} (now ${levNow.toFixed(2)}x)`;
      if (r.kind === RuleKind.LossCooldown) {
        const w0 = monitors[i]!.w0;
        if (w0 > 0n) {
          const since = block - (w0 - 1n);
          cooldownBlocksLeft = since >= r.p2 ? 0 : Number(r.p2 - since);
        }
        return `${base} (${cooldownBlocksLeft ? `${cooldownBlocksLeft} blocks left` : "ready"})`;
      }
      if (r.kind === RuleKind.MaxDrawdown && monitors[i]!.w0 > 0n) {
        const peak = cnsToUsd(monitors[i]!.w0);
        return `${base} (peak $${peak.toFixed(2)}, now ${(((peak - equityUsd) / peak) * 100).toFixed(2)}% below)`;
      }
      return base;
    });

    return {
      block,
      network: net.key,
      equityUsd,
      positions: state.markets.map((p) => ({
        market: net.markets.find((m) => m.perpId === p.marketId)?.symbol ?? `perp ${p.marketId}`,
        side: p.size > 0n ? "long" : "short",
        notionalUsd: cnsToUsd(p.notional),
        upnlUsd: cnsToUsd(p.upnl),
      })),
      marks,
      limits,
      cooldownBlocksLeft,
      maxLeverage: (() => {
        const r = rules.find((x) => x.kind === RuleKind.MaxLeverage);
        return r ? Number(r.p1) / 10_000 : undefined;
      })(),
      marketCapsUsd: Object.fromEntries(
        rules
          .filter((r) => r.kind === RuleKind.MaxNotionalPerMarket)
          .map((r) => [net.markets.find((m) => BigInt(m.perpId) === r.p1)?.symbol ?? `perp ${r.p1}`, cnsToUsd(r.p2)]),
      ),
      signals: await this.cfg.signals(tradable.map((m) => m.symbol)),
      history: this.history,
    };
  }

  private async submit(d: Decision, rules: Rule[], state: AccountState, block: bigint): Promise<LogRecord> {
    const base: LogRecord = {
      ts: new Date().toISOString(),
      block: block.toString(),
      account: this.cfg.mandateAccount,
      provider: this.cfg.provider.name,
      intent: { action: d.action, market: d.market, size_usd: d.size_usd },
      reasoning: d.reasoning,
      result: "held",
    };
    if (d.action === "hold" || d.size_usd <= 0) return base;

    const net = this.cfg.net;
    const m = marketBySymbol(net, d.market);
    const { mark } = await readMark(this.pub, this.dep.perplAdapter, this.cfg.mandateAccount, m.perpId);
    const price = pnsToPrice(m, mark);
    const pos = state.markets.find((p) => p.marketId === m.perpId);

    let type: OrderType;
    let lots = usdToLots(m, d.size_usd, price);
    if (d.action === "close") {
      if (!pos) return { ...base, result: "error", error: `No ${d.market} position to close` };
      type = pos.size > 0n ? OrderType.CloseLong : OrderType.CloseShort;
      const held = pos.size > 0n ? pos.size : -pos.size;
      if (lots > held || lots === 0n) lots = held;
    } else {
      type = d.action === "open_long" ? OrderType.OpenLong : OrderType.OpenShort;
    }
    if (lots === 0n) return { ...base, result: "error", error: `Size $${d.size_usd} is below one lot of ${d.market}` };

    const isBuy = type === OrderType.OpenLong || type === OrderType.CloseShort;
    const limitPNS = marketableLimit(mark, isBuy, this.cfg.slippageBps);
    const desc = orderDesc({ market: m, type, lots, limitPricePNS: limitPNS, venueLeverage: this.cfg.venueLeverage, orderDescId: block });
    const calls = [execOrdersCall(net.perplExchange, [desc])];
    const addNotional = notionalCns(m, lots, mark);
    const notionalAfter = d.action === "close" ? state.totalNotional - addNotional : state.totalNotional + addNotional;
    const rec: LogRecord = {
      ...base,
      proposedOrder: {
        market: d.market,
        side: d.action === "close" ? "close" : d.action === "open_long" ? "long" : "short",
        lots: lots.toString(),
        limitPrice: pnsToPrice(m, limitPNS),
        notionalUsd: cnsToUsd(addNotional),
        leverageAfter: state.equity > 0n ? Number((notionalAfter * 10_000n) / state.equity) / 10_000 : 0,
      },
    };

    const withViolation = (data: Hex | undefined) => {
      const v = decodeViolation(data);
      const rule = v ? rules[v.ruleIndex] : undefined;
      return v && rule
        ? {
            ruleIndex: v.ruleIndex,
            rule: RULE_NAMES[rule.kind],
            observed: v.observed.toString(),
            limit: v.limit.toString(),
            message: violationMessage(v, rule, net),
          }
        : undefined;
    };

    try {
      if (this.cfg.demo && d.action !== "close") {
        const pf = await preflightTight(this.pub, this.wallet, this.cfg.sessionKey, this.cfg.mandateAccount, calls);
        rec.preflightTxHash = pf.txHash;
      }
      const res = await executeTight(this.pub, this.wallet, this.cfg.sessionKey, this.cfg.mandateAccount, calls);
      if (res.status === "filled") {
        return { ...rec, result: "filled", txHash: res.txHash, resultBlock: res.blockNumber.toString(), gasUsed: res.gasUsed.toString() };
      }
      const violation = withViolation(res.revertData);
      if (violation && this.cfg.demo) {
        // Put the refusal on-chain: send the reverting execute with a fixed, tight gas limit.
        const hash = await this.sendReverting(calls);
        const receipt = await this.pub.waitForTransactionReceipt({ hash });
        return { ...rec, result: "blocked", violation, txHash: hash, resultBlock: receipt.blockNumber.toString() };
      }
      return violation
        ? { ...rec, result: "blocked", violation, resultBlock: res.blockNumber.toString() }
        : { ...rec, result: "error", error: res.error, resultBlock: res.blockNumber.toString() };
    } catch (err) {
      return { ...rec, result: "error", error: err instanceof Error ? err.message.split("\n")[0] : String(err), violation: withViolation(revertData(err)) };
    }
  }

  private sendReverting(calls: { target: Address; data: Hex }[]): Promise<Hex> {
    return this.wallet.writeContract({
      address: this.cfg.mandateAccount,
      abi: mandateAccountAbi,
      functionName: "execute",
      args: [calls],
      account: this.cfg.sessionKey,
      chain: this.cfg.net.chain,
      gas: DEMO_REVERT_GAS,
    });
  }

  private log(rec: LogRecord) {
    mkdirSync(dirname(this.cfg.logPath), { recursive: true });
    appendFileSync(this.cfg.logPath, `${JSON.stringify(rec)}\n`);
    const tag = rec.result === "blocked" ? "BLOCKED" : rec.result.toUpperCase();
    console.log(`[block ${rec.block}] ${tag} ${rec.intent.action} ${rec.intent.market} $${rec.intent.size_usd} — ${rec.reasoning}`);
    if (rec.violation) console.log(`  ${rec.violation.message}`);
    if (rec.error) console.log(`  error: ${rec.error}`);
  }
}
