"use client";

import Link from "next/link";

// Self-mandate mode (PRD 11.1): trade Perpl from a phone under rules you set yourself. Same MandateAccount and the
// same on-chain enforcement the agent gets, you are simply your own operator, so no bond and no keeper are needed.
import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, keccak256, parseAbi, toBytes, type Address, type Hex, type PublicClient } from "viem";
import {
  RULE_NAMES,
  allowedMarkets,
  approveCall,
  createAccountCall,
  cnsToUsd,
  decodeViolation,
  depositCall,
  describeLimit,
  execOrdersCall,
  mandateAccountAbi,
  mandateAccountFactoryAbi,
  mandateRegistryAbi,
  marketableLimit,
  maxLeverage,
  maxNotional,
  orderDesc,
  lossCooldown,
  measureBlockTimeMs,
  orderRateLimit,
  priceCollar,
  perplExchangeAbi,
  pnsToPrice,
  readAccountState,
  readMark,
  readRules,
  revertData,
  slippageWithinCollar,
  usdToCns,
  usdToLots,
  venueErrorMessage,
  violationMessage,
  OrderType,
  type MarketInfo,
  type Rule,
} from "@mandate/common";
import { AppHeader } from "@/components/AppHeader";
import { useMera } from "@/lib/mera";
import { useFaucet } from "@/lib/faucet";
import { clients, shortAddr, usd, useConfig, type AppConfig } from "@/lib/client";
import { errorText, sendTight } from "@/lib/tx";
import s from "./page.module.css";

/** One self-mandate account per passkey, at a fixed salt so it is found again from the passkey alone. */
const SELF_SALT = keccak256(toBytes("mandate.self.v1"));
/** No Nansen report underwrites a self-mandate: you set the limits, so the mandate stores no report hash. */
const NO_REPORT = `0x${"0".repeat(64)}` as Hex;
/** Perpl's minimum first deposit (docs/spikes.md S1): 100 AUSD on testnet, 10 on mainnet. Read live, never assumed. */
const perplMinAbi = parseAbi(["function getMinAccountOpenCNS() view returns (uint256)"]);

/** Whether this account already has a Perpl account (the first deposit must meet Perpl's minimum). */
async function venueOpen(pub: PublicClient, exchange: Address, account: Address): Promise<boolean> {
  try {
    const info = (await pub.readContract({ address: exchange, abi: perplExchangeAbi, functionName: "getAccountByAddr", args: [account] })) as {
      accountId: bigint;
    };
    return info.accountId !== 0n;
  } catch {
    return false;
  }
}

/** Self-mandates carry no bond, so there is no dispute to hold open. */
const DISPUTE_WINDOW = 0n;

interface Limits {
  leverage: number;
  sizeUsd: number;
  markets: number[];
  /** Price protection (D14): reject orders priced more than this % from the market. 0 = off. */
  collarPct: number;
  /** No revenge trading: after a loss of COOLDOWN_LOSS_USD or more, no new risk for this many minutes. 0 = off. */
  cooldownMin: number;
}

const DEFAULT_LIMITS: Limits = { leverage: 3, sizeUsd: 250, markets: [], collarPct: 0, cooldownMin: 15 };

/** The loss that starts a cooldown. */
const COOLDOWN_LOSS_USD = 5;

/**
 * Action rules only. They are checked inside `execute`, so a trade that breaks one reverts and nothing reaches the
 * venue: no keeper, no bond, nothing to trust. Market rules like max drawdown need a bonded operator to mean
 * anything, which a self-trader does not have.
 */
function rulesFrom(limits: Limits, markets: MarketInfo[], blockMs: number): Rule[] {
  const chosen = limits.markets.length ? limits.markets : markets.map((m) => m.perpId);
  // Windows count blocks, never seconds (CLAUDE.md rule 6); minutes are converted with the block time measured now.
  const cooldownBlocks = Math.max(1, Math.round((limits.cooldownMin * 60_000) / blockMs));
  return [
    allowedMarkets(chosen),
    maxLeverage(limits.leverage),
    ...chosen.map((perpId) => maxNotional(perpId, usdToCns(limits.sizeUsd))),
    orderRateLimit(10, 600),
    ...(limits.cooldownMin > 0 ? [lossCooldown(usdToCns(COOLDOWN_LOSS_USD), cooldownBlocks)] : []),
    ...(limits.collarPct > 0 ? [priceCollar(limits.collarPct)] : []),
  ];
}

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "filled"; hash: Hex }
  | { kind: "no-fill" }
  | { kind: "blocked"; message: string; rule: string };

interface View {
  equity: bigint;
  notional: bigint;
  walletAusd: bigint;
  rules: Rule[];
  /** False until the first deposit opens the account on Perpl. */
  venueOpen: boolean;
  /** Perpl's minimum first deposit, in AUSD base units. */
  minOpen: bigint;
}

export default function SelfMandatePage() {
  const cfg = useConfig();
  const mera = useMera();
  const [account, setAccount] = useState<Address>();
  const [created, setCreated] = useState<boolean>();
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string>();
  const [view, setView] = useState<View>();

  const markets = useMemo(() => cfg?.markets ?? [], [cfg]);
  const signer = mera.account;

  // The account address follows from the passkey, so signing in on another device finds the same account.
  useEffect(() => {
    if (!cfg?.deployment || !signer) return;
    let live = true;
    const owner = signer.address;
    void (async () => {
      const { pub } = clients(cfg, signer);
      const predicted = (await pub.readContract({
        address: cfg.deployment!.mandateAccountFactory,
        abi: mandateAccountFactoryAbi,
        functionName: "predictAddress",
        args: [owner, owner, SELF_SALT],
      })) as Address;
      const code = await pub.getCode({ address: predicted });
      if (!live) return;
      setAccount(predicted);
      setCreated(Boolean(code && code !== "0x"));
    })().catch((e) => setError(errorText(e)));
    return () => {
      live = false;
    };
  }, [cfg, signer]);

  const refresh = useCallback(async () => {
    if (!cfg?.deployment || !account || !signer || !created) return;
    const dep = cfg.deployment;
    const { pub } = clients(cfg, signer);
    const [state, walletAusd, { rules }, open, minOpen] = await Promise.all([
      readAccountState(pub, dep.perplAdapter, account),
      pub.readContract({ address: dep.collateralToken, abi: erc20Abi, functionName: "balanceOf", args: [signer.address] }) as Promise<bigint>,
      readRules(pub, dep.mandateRegistry, account),
      venueOpen(pub, dep.perplExchange, account),
      pub.readContract({ address: dep.perplExchange, abi: perplMinAbi, functionName: "getMinAccountOpenCNS" }) as Promise<bigint>,
    ]);
    setView({ equity: state.equity, notional: state.totalNotional, walletAusd, rules, venueOpen: open, minOpen });
  }, [cfg, account, signer, created]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [refresh]);

  async function createAccountAndRules() {
    if (!cfg?.deployment || !signer || !account) return;
    setError(undefined);
    const dep = cfg.deployment;
    try {
      const { pub, wallet } = clients(cfg, signer);
      setPhase({ kind: "working", step: "Creating your account" });
      await sendTight(pub, wallet, {
        address: dep.mandateAccountFactory,
        abi: mandateAccountFactoryAbi,
        functionName: "createAccount",
        args: [signer.address, SELF_SALT],
      });
      setPhase({ kind: "working", step: "Writing your rules on-chain" });
      const blockMs = await measureBlockTimeMs(pub, 200n);
      await sendTight(pub, wallet, {
        address: dep.mandateRegistry,
        abi: mandateRegistryAbi,
        functionName: "createMandate",
        args: [account, rulesFrom(limits, markets, blockMs), NO_REPORT, DISPUTE_WINDOW],
      });
      setCreated(true);
      setPhase({ kind: "idle" });
    } catch (e) {
      setError(errorText(e));
      setPhase({ kind: "idle" });
    }
  }

  async function addFunds(amountUsd: number) {
    if (!cfg?.deployment || !signer || !account) return;
    setError(undefined);
    const dep = cfg.deployment;
    try {
      const { pub, wallet } = clients(cfg, signer);
      const amount = usdToCns(amountUsd);
      setPhase({ kind: "working", step: "Moving AUSD into your account" });
      await sendTight(pub, wallet, { address: dep.collateralToken, abi: erc20Abi, functionName: "transfer", args: [account, amount] });

      // A venue account is opened once; after that the same AUSD is deposited into the existing one.
      let venueExists = false;
      try {
        const info = (await pub.readContract({
          address: dep.perplExchange,
          abi: perplExchangeAbi,
          functionName: "getAccountByAddr",
          args: [account],
        })) as { accountId: bigint };
        venueExists = info.accountId !== 0n;
      } catch {
        venueExists = false;
      }

      setPhase({ kind: "working", step: venueExists ? "Depositing on Perpl" : "Opening your Perpl account" });
      await sendTight(pub, wallet, {
        address: account,
        abi: mandateAccountAbi,
        functionName: "execute",
        args: [
          [
            approveCall(dep.collateralToken, dep.perplExchange, 2n ** 255n),
            venueExists ? depositCall(dep.perplExchange, amount) : createAccountCall(dep.perplExchange, amount),
          ],
        ],
      });
      setPhase({ kind: "idle" });
      await refresh();
    } catch (e) {
      setError(errorText(e));
      setPhase({ kind: "idle" });
    }
  }

  async function placeOrder(market: MarketInfo, side: "long" | "short" | "close", sizeUsd: number) {
    if (!cfg?.deployment || !signer || !account) return;
    setError(undefined);
    const dep = cfg.deployment;
    try {
      const { pub, wallet } = clients(cfg, signer);
      const state = await readAccountState(pub, dep.perplAdapter, account);
      const { mark, markValid } = await readMark(pub, dep.perplAdapter, account, market.perpId);
      if (!markValid) throw new Error(`No live ${market.symbol} price on Perpl right now.`);
      const pos = state.markets.find((m) => m.marketId === market.perpId);

      let type: OrderType;
      let lots = usdToLots(market, sizeUsd, pnsToPrice(market, mark));
      if (side === "close") {
        if (!pos) throw new Error(`You have no ${market.symbol} position to close.`);
        type = pos.size > 0n ? OrderType.CloseLong : OrderType.CloseShort;
        lots = pos.size > 0n ? pos.size : -pos.size;
      } else {
        type = side === "long" ? OrderType.OpenLong : OrderType.OpenShort;
      }
      if (lots === 0n) throw new Error(`${usd(sizeUsd)} is below one lot of ${market.symbol}.`);

      const isBuy = type === OrderType.OpenLong || type === OrderType.CloseShort;
      const block = await pub.getBlockNumber();
      const desc = orderDesc({
        market,
        type,
        lots,
        limitPricePNS: marketableLimit(mark, isBuy, slippageWithinCollar(view?.rules ?? [], 100)),
        venueLeverage: limits.leverage,
        orderDescId: block,
      });

      setPhase({ kind: "working", step: side === "close" ? "Closing your position" : "Placing your order" });
      const before = state.totalNotional;
      const { hash } = await sendTight(pub, wallet, {
        address: account,
        abi: mandateAccountAbi,
        functionName: "execute",
        args: [[execOrdersCall(dep.perplExchange, [desc])]],
      });
      // An IOC order that crosses nothing still succeeds, so the position decides whether anything happened.
      const after = await readAccountState(pub, dep.perplAdapter, account);
      setPhase(after.totalNotional === before ? { kind: "no-fill" } : { kind: "filled", hash });
      await refresh();
    } catch (e) {
      const data = revertData(e);
      const v = decodeViolation(data);
      const rule = v && view ? view.rules[v.ruleIndex] : undefined;
      if (v && rule && cfg) {
        setPhase({ kind: "blocked", message: violationMessage(v, rule, netOf(cfg)), rule: RULE_NAMES[rule.kind] });
      } else {
        // A rule is not the only thing that can stop a trade: Perpl rejects orders its own balance cannot settle.
        setError(venueErrorMessage(data) ?? errorText(e));
        setPhase({ kind: "idle" });
      }
    }
  }

  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <div className="atmosphere" aria-hidden />
        {!signer && <SignIn mera={mera} />}

        {signer && created === false && (
          <SetRules limits={limits} setLimits={setLimits} markets={markets} onCreate={createAccountAndRules} phase={phase} />
        )}

        {signer && created && account && (
          <Trade
            account={account}
            owner={signer.address}
            faucet={Boolean(cfg?.faucet)}
            view={view}
            markets={markets}
            limits={limits}
            phase={phase}
            onFund={addFunds}
            onOrder={placeOrder}
          />
        )}

        {error && <p className={s.error}>{error}</p>}
      </main>
    </>
  );
}

/** Rule copy only needs market names, which the browser config already carries. */
const netOf = (cfg: AppConfig) => ({ markets: cfg.markets });

/** What this page gives a trader that an exchange account can't. Each line is something the contracts enforce. */
const WHY = [
  {
    title: "Rules you can't break on a bad day",
    body: "Leverage, position size and markets are checked inside every trade on Monad. An exchange setting changes in a click; yours can only get stricter.",
  },
  {
    title: "No revenge trading",
    body: "Choose a cooldown: after a loss, you can't add risk until it ends. Closing a position is always allowed.",
  },
  {
    title: "Price protection",
    body: "Switch it on and orders priced too far from the market are refused, so a fat finger can't fill at a silly price.",
  },
  {
    title: "A record anyone can check",
    body: "Every trade and every blocked attempt is on-chain. Your discipline is provable, not a screenshot.",
  },
];

function SignIn({ mera }: { mera: ReturnType<typeof useMera> }) {
  return (
    <>
      <section className={s.intro}>
        <p className={s.kicker}>Self-custody perps on Monad</p>
        <h1 className="display">Trade under your own rules.</h1>
        <p className={s.lede}>
          Set your limits once. Trade Perpl perpetuals with Agora&rsquo;s AUSD from your phone. Any trade that would
          break your limits is stopped on-chain, before it reaches the exchange.
        </p>
      </section>

      <section className={`card ${s.signin}`}>
        <button className="button-primary" onClick={() => void mera.signIn()} disabled={mera.busy}>
          {mera.busy ? "Waiting for your passkey" : mera.hasPasskey ? "Sign in with your passkey" : "Create your account"}
        </button>
        <p className={s.fine}>No seed phrase, no extension. Your face or fingerprint is the account (Mera passkeys).</p>
        <div className={s.or}>
          <span>or</span>
        </div>
        <button className={s.secondary} onClick={() => void mera.connectWallet()} disabled={mera.busy}>
          Use a browser wallet
        </button>
        <p className={s.fine}>
          MetaMask, Rabby and other browser wallets work too. We switch the wallet to Monad testnet.
        </p>
        {mera.error && <p className={s.error}>{mera.error}</p>}
        <Link className={s.inlineLink} href="/agents">
          Just looking? Watch the live agent trade
        </Link>
      </section>

      <section className={s.why} aria-labelledby="why-h">
        <h2 id="why-h" className={s.h2}>
          What you get here that an exchange can&rsquo;t give you
        </h2>
        <ul>
          {WHY.map((w) => (
            <li key={w.title}>
              <strong>{w.title}</strong>
              <span>{w.body}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function SetRules({
  limits,
  setLimits,
  markets,
  onCreate,
  phase,
}: {
  limits: Limits;
  setLimits: (l: Limits) => void;
  markets: MarketInfo[];
  onCreate: () => void;
  phase: Phase;
}) {
  const working = phase.kind === "working";
  const chosen = limits.markets.length ? limits.markets : markets.map((m) => m.perpId);
  return (
    <section className={`card ${s.form}`}>
      <p className={s.kicker}>Step 1 of 3</p>
      <h1 className="section-heading">Set your rules</h1>
      <p className="body-secondary">The chain holds you to these. You can tighten them later, never loosen them.</p>

      <div className={s.field}>
        <span>Most leverage</span>
        <div className={s.choices}>
          {[2, 3, 5, 10].map((x) => (
            <button key={x} type="button" data-on={limits.leverage === x || undefined} onClick={() => setLimits({ ...limits, leverage: x })}>
              {x}x
            </button>
          ))}
        </div>
      </div>

      <div className={s.field}>
        <span>Biggest position</span>
        <div className={s.choices}>
          {[100, 250, 1000].map((v) => (
            <button key={v} type="button" data-on={limits.sizeUsd === v || undefined} onClick={() => setLimits({ ...limits, sizeUsd: v })}>
              {usd(v)}
            </button>
          ))}
        </div>
      </div>

      <div className={s.field}>
        <span>Markets you can trade</span>
        <div className={s.choices}>
          {markets.map((m) => (
            <button
              key={m.perpId}
              type="button"
              data-on={chosen.includes(m.perpId) || undefined}
              onClick={() => {
                const next = chosen.includes(m.perpId) ? chosen.filter((id) => id !== m.perpId) : [...chosen, m.perpId];
                setLimits({ ...limits, markets: next.length ? next : chosen });
              }}
            >
              {m.symbol}
            </button>
          ))}
        </div>
      </div>

      <div className={s.field}>
        <span>Cooldown after a loss</span>
        <div className={s.choices}>
          {[0, 5, 15, 60].map((min) => (
            <button
              key={min}
              type="button"
              data-on={limits.cooldownMin === min || undefined}
              onClick={() => setLimits({ ...limits, cooldownMin: min })}
            >
              {min === 0 ? "Off" : min === 60 ? "1 hour" : `${min} min`}
            </button>
          ))}
        </div>
        <p className={s.fine}>
          After you lose ${COOLDOWN_LOSS_USD} or more on a trade, you can&rsquo;t add risk for this long. No revenge
          trading. Closing a position is always allowed.
        </p>
      </div>

      <div className={s.field}>
        <span>Price protection</span>
        <div className={s.choices}>
          {[0, 1, 2, 5].map((pct) => (
            <button
              key={pct}
              type="button"
              data-on={limits.collarPct === pct || undefined}
              onClick={() => setLimits({ ...limits, collarPct: pct })}
            >
              {pct === 0 ? "Off" : `${pct}%`}
            </button>
          ))}
        </div>
        <p className={s.fine}>
          Blocks any order priced further than this from the market: the check that would have stopped a runaway
          algorithm like Knight Capital's. Closing a position is never blocked.
        </p>
      </div>

      <button className="button-primary" onClick={onCreate} disabled={working}>
        {working ? phase.step : "Create my account"}
      </button>
      <p className={s.fine}>Two signatures: one creates the account, one writes the rules.</p>
    </section>
  );
}

function Trade({
  account,
  owner,
  faucet,
  view,
  markets,
  limits,
  phase,
  onFund,
  onOrder,
}: {
  account: Address;
  /** The signed-in wallet that funds the account. */
  owner: Address;
  /** The testnet faucet is switched on. */
  faucet: boolean;
  view?: View;
  markets: MarketInfo[];
  limits: Limits;
  phase: Phase;
  onFund: (usd: number) => void;
  onOrder: (m: MarketInfo, side: "long" | "short" | "close", usd: number) => void;
}) {
  const tradable = useMemo(() => markets.filter((m) => !limits.markets.length || limits.markets.includes(m.perpId)), [markets, limits]);
  const [market, setMarket] = useState<MarketInfo | undefined>(tradable[0]);
  const [size, setSize] = useState("50");
  const working = phase.kind === "working";
  const active = market ?? tradable[0];
  // The first deposit opens the Perpl account and must meet Perpl's minimum; after that, add in $50 steps.
  const walletUsd = view ? cnsToUsd(view.walletAusd) : 0;
  const minOpenUsd = view ? cnsToUsd(view.minOpen) : 0;
  const addable = !view ? 0 : view.venueOpen ? Math.min(50, walletUsd) : walletUsd >= minOpenUsd ? minOpenUsd : 0;
  const shortOfMinimum = Boolean(view && !view.venueOpen && walletUsd < minOpenUsd);

  const { drip, getTestFunds } = useFaucet();
  const empty = Boolean(view && view.walletAusd === 0n && view.equity <= 0n);

  useEffect(() => {
    if (!market && tradable[0]) setMarket(tradable[0]);
  }, [market, tradable]);

  return (
    <>
      {empty && (
        <section className={`card ${s.start}`} aria-labelledby="start-h">
          <p className={s.kicker}>Step 2 of 3</p>
          <h2 id="start-h" className={s.h2}>
            Fund your account
          </h2>
          <p className="body-secondary">
            Your rules are on-chain. Now it needs AUSD to trade with, and a little MON for gas. On testnet both are free.
          </p>
          {faucet ? (
            <button className="button-primary" onClick={() => void getTestFunds(owner)} disabled={drip.state === "busy" || drip.state === "done"}>
              {drip.state === "busy" ? "Sending test funds" : drip.state === "done" ? "Test funds sent" : "Get test MON and AUSD"}
            </button>
          ) : (
            <p className={s.fine}>The test faucet is off right now. Send test AUSD to {shortAddr(owner)} to begin.</p>
          )}
          {drip.text && <p className={drip.state === "error" ? s.error : s.ok}>{drip.text}</p>}
          <p className={s.fine}>Then open your Perpl account below and place your first trade.</p>
        </section>
      )}
      <section className={`card ${s.balance}`}>
        <p className={s.balanceLabel}>Trading account balance</p>
        <p className={s.balanceValue}>
          {view ? cnsToUsd(view.equity).toFixed(2) : "0.00"} <span className={s.unit}>AUSD</span>
        </p>
        <p className="body-secondary">
          Wallet: {view ? cnsToUsd(view.walletAusd).toFixed(2) : "0.00"} AUSD ·{" "}
          <span className="onchain">{shortAddr(account)}</span>
          {view && view.notional > 0n ? ` · ${usd(cnsToUsd(view.notional))} open on Perpl` : ""}
        </p>
        {addable > 0 && (
          <button className={s.secondary} onClick={() => onFund(addable)} disabled={working}>
            {view?.venueOpen ? `Add ${usd(addable)} AUSD` : `Open your account with ${usd(addable)} AUSD`}
          </button>
        )}
        {shortOfMinimum && (
          <p className={s.fine}>
            Perpl needs at least {usd(minOpenUsd)} AUSD to open your trading account. Your wallet has {usd(walletUsd)}.
          </p>
        )}
      </section>

      <section className={`card ${s.ticket}`}>
        <div className={s.choices}>
          {tradable.map((m) => (
            <button key={m.perpId} type="button" data-on={active?.perpId === m.perpId || undefined} onClick={() => setMarket(m)}>
              {m.symbol}
            </button>
          ))}
        </div>

        <label className={s.field}>
          <span>Size</span>
          <input inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Size in dollars" />
        </label>

        <div className={s.sides}>
          <button className={s.long} disabled={working || !active} onClick={() => active && onOrder(active, "long", Number(size))}>
            Buy
          </button>
          <button className={s.short} disabled={working || !active} onClick={() => active && onOrder(active, "short", Number(size))}>
            Sell
          </button>
        </div>
        <button className={s.secondary} disabled={working || !active} onClick={() => active && onOrder(active, "close", Number(size))}>
          Close position
        </button>

        {phase.kind === "working" && <p className={s.status}>{phase.step}…</p>}
        {phase.kind === "filled" && (
          <p className={s.ok}>
            Order placed. <span className="onchain">{shortAddr(phase.hash)}</span>
          </p>
        )}
        {phase.kind === "no-fill" && <p className={s.status}>Nothing crossed at that price. Your position is unchanged.</p>}
        {phase.kind === "blocked" && (
          <div className={s.blocked}>
            <p className={s.blockedHead}>{phase.message}</p>
            <p className={s.fine}>Your {phase.rule.toLowerCase()} rule stopped it. Nothing changed on-chain.</p>
          </div>
        )}
      </section>

      {view && view.rules.length > 0 && (
        <section className={`card ${s.rules}`}>
          <div className={s.rulesHead}>
            <h2 className={s.h2}>Your rules</h2>
            <Link className={s.inlineLink} href={`/risk/${account}`}>
              Headroom and blocked attempts
            </Link>
          </div>
          <ul>
            {view.rules.map((r, i) => (
              <li key={i}>
                <span>{RULE_NAMES[r.kind]}</span>
                <span className="onchain">{describeLimit(r)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
