"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import {
  approveCall,
  createAccountCall,
  mandateAccountAbi,
  mandateAccountFactoryAbi,
  mandateRegistryAbi,
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

  return (
    <>
      <AppHeader />
      <main className={s.main}>
        <header className={s.intro}>
          <h1 className="section-heading">Create mandate</h1>
          <p className="body-secondary">
            Pick the markets this agent may trade. Nansen evidence sets the limits, and the chain enforces them on every
            trade.
          </p>
        </header>

        <section className={`card ${s.setup}`} aria-labelledby="setup-h">
          <h2 id="setup-h" className={s.h2}>
            Markets and size
          </h2>
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
          <button type="button" className={s.secondary} onClick={runUnderwriting} disabled={loading || markets.length === 0 || !Number(base)}>
            {loading ? "Reading Nansen…" : uw ? "Run underwriting again" : "Run underwriting"}
          </button>
        </section>

        {uw && (
          <>
            {uw.report.source === "fixture" && (
              <p className={s.sample} role="note">
                Sample data. Set a Nansen API key on the server for live evidence. Sample reports are for local testing
                only.
              </p>
            )}

            <section aria-labelledby="evidence-h" className={s.block}>
              <div className={s.blockHead}>
                <h2 id="evidence-h" className={s.h2}>
                  Evidence
                </h2>
                <span className="body-secondary">Data: Nansen</span>
              </div>
              <div className={s.evidence}>
                {uw.report.markets.map((m) => (
                  <EvidenceCard key={m.symbol} market={m} />
                ))}
              </div>
            </section>

            <section aria-labelledby="limits-h" className={s.block}>
              <div className={s.blockHead}>
                <h2 id="limits-h" className={s.h2}>
                  Proposed limits
                </h2>
                <span className="body-secondary">Regime: {uw.report.mandateRegime}</span>
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

            <section className={s.actions} aria-live="polite">
              {phase.kind === "idle" && (
                <button
                  type="button"
                  className="button-primary"
                  disabled={!cfg?.deployment || (draft?.needsOverride && !draft.overrideAccepted) || mera.busy}
                  onClick={() => approve(draft?.rules ?? uw.rules)}
                >
                  Approve mandate
                </button>
              )}
              {working && <p className={s.progress}>{phase.step}…</p>}
              {phase.kind === "approved" && (
                <div className={`card ${s.done}`}>
                  <h2 className={s.h2}>Mandate approved</h2>
                  <p className="body-secondary">
                    Account <span className="onchain">{phase.account}</span>. The agent can trade it only within these
                    limits, and only you can withdraw.
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
                  </p>
                  <Link className="button-primary" href={`/agents/${phase.account}`}>
                    Watch the agent
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

