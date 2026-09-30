"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keccak256, parseAbi, toBytes, type Address, type Hex } from "viem";
import {
  approveCall,
  cnsToUsd,
  createAccountCall,
  mandateAccountAbi,
  mandateAccountFactoryAbi,
  mandateRegistryAbi,
  priceCollar,
  toAbiRule,
  usdToCns,
  type MarketSymbol,
  type Rule,
} from "@mandate/common";
import { clients, shortAddr, useConfig, usd } from "@/lib/client";
import { useMera } from "@/lib/mera";
import { errorText, sendTight } from "@/lib/tx";
import { parseUnderwrite, type UnderwriteResponse } from "@/lib/types";
import { AppHeader } from "@/components/AppHeader";
import { ReportHashVerify } from "@/components/ReportHashVerify";
import { EvidenceCard } from "./EvidenceCard";
import { reasonsForLimits } from "./limitReasons";
import { LimitsTable, type Draft } from "./LimitsTable";
import s from "./page.module.css";

const ALL: MarketSymbol[] = ["BTC", "ETH", "MON", "SOL"];
/** ~30 days of 0.3 s blocks. The owner can revoke the key at any time. */
const SESSION_KEY_BLOCKS = 8_640_000n;

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: string }
  | { kind: "approved"; account: Address; mandateId: bigint; txs: Hex[]; onChainReportHash: Hex }
  | { kind: "funded"; account: Address; onChainReportHash: Hex };

export default function CreateMandate() {
  const cfg = useConfig();
  const mera = useMera();
  const [markets, setMarkets] = useState<MarketSymbol[]>(["BTC", "ETH"]);
  const [base, setBase] = useState("1000");
  const [uw, setUw] = useState<UnderwriteResponse>();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Draft>();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [fund, setFund] = useState("100");
  /** Price protection (D14): the backer's own addition on top of Nansen's limits. 0 = off. */
  const [collarPct, setCollarPct] = useState(0);
  const [error, setError] = useState<string>();

  const available = useMemo(() => ALL.filter((m) => cfg?.markets.some((x) => x.symbol === m)), [cfg]);

  async function runUnderwriting() {
    setLoading(true);
    setError(undefined);
    try {
      const r = await fetch("/api/underwrite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markets, baseNotionalUsd: Number(base) }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "Underwriting failed.");
      setUw(parseUnderwrite(body));
      setDraft(undefined);
      setPhase({ kind: "idle" });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function approve(rules: Rule[]) {
    if (!cfg?.deployment || !uw) return;
    setError(undefined);
    const dep = cfg.deployment;
    try {
      const account = mera.account ?? (await mera.signIn());
      if (!account) return;
      if (cfg.devFaucet) {
        setPhase({ kind: "working", step: "Adding test gas to your passkey account" });
        await fetch("/api/dev/fund", { method: "POST", body: JSON.stringify({ gasTo: account.address }) });
      }
      const { pub, wallet } = clients(cfg, account);
      const txs: Hex[] = [];

      setPhase({ kind: "working", step: "Creating your trading account" });
      const salt = keccak256(toBytes(`${uw.reportHash}:${Date.now()}`));
      const predicted = (await pub.readContract({
        address: dep.mandateAccountFactory,
        abi: mandateAccountFactoryAbi,
        functionName: "predictAddress",
        args: [account.address, cfg.agent.operator, salt],
      })) as Address;
      txs.push((await sendTight(pub, wallet, { address: dep.mandateAccountFactory, abi: mandateAccountFactoryAbi, functionName: "createAccount", args: [cfg.agent.operator, salt] })).hash);

      setPhase({ kind: "working", step: "Writing the mandate on-chain" });
      txs.push(
        (
          await sendTight(pub, wallet, {
            address: dep.mandateRegistry,
            abi: mandateRegistryAbi,
            functionName: "createMandate",
            args: [predicted, rules.map(toAbiRule), uw.reportHash, 600n],
          })
        ).hash,
      );
      const mandateId = (await pub.readContract({ address: dep.mandateRegistry, abi: mandateRegistryAbi, functionName: "mandateIdOf", args: [predicted] })) as bigint;
      const [mandate] = await pub.readContract({
        address: dep.mandateRegistry,
        abi: mandateRegistryAbi,
        functionName: "getMandate",
        args: [mandateId],
      });

      setPhase({ kind: "working", step: "Giving the agent its trading key" });
      const head = await pub.getBlockNumber();
      txs.push((await sendTight(pub, wallet, { address: predicted, abi: mandateAccountAbi, functionName: "setSessionKey", args: [cfg.agent.sessionKey, head + SESSION_KEY_BLOCKS] })).hash);

      setPhase({ kind: "approved", account: predicted, mandateId, txs, onChainReportHash: mandate.reportHash });
    } catch (e) {
      setError(errorText(e));
      setPhase({ kind: "idle" });
    }
  }

  async function fundAccount(accountAddr: Address, onChainReportHash: Hex) {
    if (!cfg?.deployment) return;
    setError(undefined);
    const dep = cfg.deployment;
    try {
      const account = mera.account ?? (await mera.signIn());
      if (!account) return;
      const amount = usdToCns(Number(fund));
      const { pub, wallet } = clients(cfg, account);
      // The first deposit opens the Perpl account and must meet Perpl's minimum (100 AUSD on testnet, 10 on mainnet).
      const minOpen = (await pub.readContract({
        address: dep.perplExchange,
        abi: parseAbi(["function getMinAccountOpenCNS() view returns (uint256)"]),
        functionName: "getMinAccountOpenCNS",
      })) as bigint;
      if (amount < minOpen) {
        setError(`Perpl needs at least ${cnsToUsd(minOpen).toLocaleString("en-US")} AUSD to open the account. Enter ${cnsToUsd(minOpen)} or more.`);
        return;
      }
      setPhase({ kind: "working", step: "Moving AUSD into the account" });
      if (cfg.devFaucet) {
        await fetch("/api/dev/fund", { method: "POST", body: JSON.stringify({ ausdTo: accountAddr, ausdUsd: Number(fund) }) });
      } else {
        await sendTight(pub, wallet, { address: dep.collateralToken, abi: erc20Abi, functionName: "transfer", args: [accountAddr, amount] });
      }
      setPhase({ kind: "working", step: "Opening the Perpl account" });
      await sendTight(pub, wallet, {
        address: accountAddr,
        abi: mandateAccountAbi,
        functionName: "execute",
        args: [[approveCall(dep.collateralToken, dep.perplExchange, 2n ** 255n), createAccountCall(dep.perplExchange, amount)]],
      });
      setPhase({ kind: "funded", account: accountAddr, onChainReportHash });
    } catch (e) {
      setError(errorText(e));
      setPhase({ kind: "approved", account: accountAddr, mandateId: 0n, txs: [], onChainReportHash });
    }
  }

  const working = phase.kind === "working";
  const liveReport = uw?.report.source === "nansen";

  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <header className={s.intro}>
          <div className={s.introTop}>
            {cfg && (
              <span className={s.liveBadge} data-live={cfg.nansenLive || undefined}>
                {cfg.nansenLive ? "Nansen connected" : "Nansen key missing"}
              </span>
            )}
          </div>
          <h1 className="section-heading">Back an agent</h1>
          <p className="body-secondary">
            Nansen&rsquo;s smart-money data sets the limits, and every limit names the signal behind it. When you
            approve, the report&rsquo;s fingerprint is stored on Monad so anyone can check it later.
          </p>
        </header>

        {cfg && !cfg.nansenLive && (
          <p className={s.blocked} role="alert">
            Nansen isn&rsquo;t connected on this server, so limits can&rsquo;t be set from live data. Add{" "}
            <span className="onchain">NANSEN_API_KEY</span> to the server environment and reload.
          </p>
        )}

        <section className={`card ${s.setup}`} aria-labelledby="setup-h">
          <h2 id="setup-h" className={s.h2}>
            Markets and size
          </h2>
          <p className={s.setupHint}>
            Choose the markets this agent may trade and a starting position size. Nansen shrinks it when smart money
            is leaving a market and allows more when it is arriving.
          </p>
          <div className={s.chips} role="group" aria-label="Markets">
            {available.map((m) => {
              const on = markets.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  className={s.chip}
                  aria-pressed={on}
                  onClick={() => setMarkets(on ? markets.filter((x) => x !== m) : [...markets, m])}
                >
                  {m}
                </button>
              );
            })}
          </div>
          <label className={s.field}>
            <span>Base position size per market</span>
            <span className={s.inputWrap}>
              <span aria-hidden>$</span>
              <input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value.replace(/[^\d.]/g, ""))} />
            </span>
          </label>
          <button
            type="button"
            className="button-primary"
            onClick={runUnderwriting}
            disabled={loading || markets.length === 0 || !Number(base) || cfg?.nansenLive === false}
          >
            {loading ? "Reading Nansen…" : uw ? "Check again with Nansen" : "Get limits from Nansen"}
          </button>
        </section>

        {error && !uw && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        {uw && (
          <>
            <section className={`card ${s.metaCard}`} aria-label="Underwriting report summary">
              <dl className={s.metaGrid}>
                <div>
                  <dt>Source</dt>
                  <dd data-ok={liveReport || undefined}>{liveReport ? "Live Nansen data" : "Sample data"}</dd>
                </div>
                <div>
                  <dt>Nansen&rsquo;s read</dt>
                  <dd>{uw.report.mandateRegime}</dd>
                </div>
                <div>
                  <dt>Credits used</dt>
                  <dd>{uw.report.creditsUsed}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(uw.report.createdAt).toLocaleString()}</dd>
                </div>
              </dl>
              <p className={s.attribution}>{uw.report.attribution}</p>
            </section>

            <section aria-labelledby="evidence-h" className={s.block}>
              <div className={s.blockHead}>
                <div>
                  <h2 id="evidence-h" className={s.h2}>
                    Nansen evidence
                  </h2>
                  <p className={s.blockSub}>
                    Positioning, flows and concentration per market — the inputs behind every limit below.
                  </p>
                </div>
              </div>
              <div className={s.evidence}>
                {uw.report.markets.map((m) => (
                  <EvidenceCard key={m.symbol} market={m} />
                ))}
              </div>
            </section>

            <section aria-labelledby="limits-h" className={s.block}>
              <div className={s.blockHead}>
                <div>
                  <h2 id="limits-h" className={s.h2}>
                    Proposed limits
                  </h2>
                  <p className={s.blockSub}>
                    Each row shows the Nansen signal behind the number. You can loosen a limit, but the stored
                    fingerprint still records what Nansen proposed.
                  </p>
                </div>
                <span className={s.regimePill}>Nansen read: {uw.report.mandateRegime}</span>
              </div>
              <LimitsTable
                proposal={uw.rules}
                labels={uw.report.proposal.map((p) => p.label)}
                because={reasonsForLimits(uw.report, uw.rules)}
                markets={cfg?.markets ?? []}
                draft={draft}
                onChange={setDraft}
                disabled={phase.kind !== "idle"}
              />
              <ReportHashVerify
                expectedHash={uw.reportHash}
                onChainHash={
                  phase.kind === "approved" || phase.kind === "funded" ? phase.onChainReportHash : null
                }
              />
            </section>

            {phase.kind === "idle" && (
              <section className={`card ${s.setup}`} aria-labelledby="collar-h">
                <h2 id="collar-h" className={s.h2}>
                  Price protection
                </h2>
                <p className={s.setupHint}>
                  Your own addition, not part of Nansen&rsquo;s report: block any order the agent prices further than
                  this from the market. Closing a position is never blocked.
                </p>
                <div className={s.chips} role="group" aria-label="Price protection">
                  {[0, 1, 2, 5].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className={s.chip}
                      aria-pressed={collarPct === pct}
                      onClick={() => setCollarPct(pct)}
                    >
                      {pct === 0 ? "Off" : `${pct}%`}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className={s.actions} aria-live="polite">
              {phase.kind === "idle" && (
                <button
                  type="button"
                  className="button-primary"
                  disabled={!cfg?.deployment || (draft?.needsOverride && !draft.overrideAccepted) || mera.busy}
                  onClick={() => {
                    const rules = draft?.rules ?? uw.rules;
                    void approve(collarPct > 0 ? [...rules, priceCollar(collarPct)] : rules);
                  }}
                >
                  Approve mandate on-chain
                </button>
              )}
              {working && <p className={s.progress}>{phase.step}…</p>}
              {phase.kind === "approved" && (
                <div className={`card ${s.done}`}>
                  <h2 className={s.h2}>Mandate approved</h2>
                  <p className="body-secondary">
                    Account <span className="onchain">{phase.account}</span>. Mandate id{" "}
                    <span className="onchain">{phase.mandateId.toString()}</span>. The agent can trade only within
                    these limits; only you can withdraw.
                  </p>
                  <p className={s.hashLine}>
                    Report fingerprint on Monad <span className="onchain">{phase.onChainReportHash}</span>
                  </p>
                  <label className={s.field}>
                    <span>Fund with AUSD</span>
                    <span className={s.inputWrap}>
                      <span aria-hidden>$</span>
                      <input inputMode="decimal" value={fund} onChange={(e) => setFund(e.target.value.replace(/[^\d.]/g, ""))} />
                    </span>
                  </label>
                  <button type="button" className="button-primary" onClick={() => fundAccount(phase.account, phase.onChainReportHash)} disabled={!Number(fund)}>
                    Fund account
                  </button>
                </div>
              )}
              {phase.kind === "funded" && (
                <div className={`card ${s.done}`}>
                  <h2 className={s.h2}>Account funded</h2>
                  <p className="body-secondary">
                    {usd(Number(fund))} is on Perpl in <span className="onchain">{shortAddr(phase.account)}</span>.
                    Limits from this Nansen report are now live on every trade.
                  </p>
                  <Link className="button-primary" href={`/agents/${phase.account}`}>
                    Watch enforcement
                  </Link>
                </div>
              )}
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              {mera.error && (
                <p className={s.error} role="alert">
                  {mera.error}
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}

const erc20Abi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

