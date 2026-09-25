"use client";

import { useCallback, useState } from "react";
import { keccak256, toBytes, type Hex } from "viem";
import s from "./ReportHashVerify.module.css";

type VerifyState =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "ok"; recomputed: Hex; storedMatch: boolean; chainMatch: boolean | null }
  | { kind: "error"; message: string };

/**
 * Trust nothing, check everything: fetch the stored report, rehash it in the browser,
 * and compare to the underwriting hash (and the on-chain mandate hash when present).
 */
export function ReportHashVerify(props: {
  expectedHash: Hex;
  /** Read back from MandateRegistry after createMandate. */
  onChainHash?: Hex | null;
  compact?: boolean;
}) {
  const { expectedHash, onChainHash, compact } = props;
  const [state, setState] = useState<VerifyState>({ kind: "idle" });

  const verify = useCallback(async () => {
    setState({ kind: "working" });
    try {
      const r = await fetch(`/api/reports/${expectedHash}`);
      if (!r.ok) throw new Error(r.status === 404 ? "Stored report not found." : `Could not load report (${r.status}).`);
      const body = await r.text();
      const recomputed = keccak256(toBytes(body));
      const storedMatch = recomputed.toLowerCase() === expectedHash.toLowerCase();
      const chainMatch = onChainHash != null ? recomputed.toLowerCase() === onChainHash.toLowerCase() : null;
      setState({ kind: "ok", recomputed, storedMatch, chainMatch });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [expectedHash, onChainHash]);

  const verdict =
    state.kind === "ok"
      ? state.storedMatch && (state.chainMatch === null || state.chainMatch)
        ? "match"
        : "mismatch"
      : null;

  return (
    <div className={compact ? `${s.verify} ${s.compact}` : s.verify} data-verdict={verdict ?? undefined}>
      <div className={s.head}>
        <p className={s.hash}>
          Report hash <span className="onchain">{expectedHash}</span>
          {" · "}
          <a href={`/api/reports/${expectedHash}`} target="_blank" rel="noreferrer">
            View report
          </a>
        </p>
        <button type="button" className={s.button} onClick={verify} disabled={state.kind === "working"}>
          {state.kind === "working" ? "Verifying…" : "Verify hash"}
        </button>
      </div>

      {state.kind === "ok" && (
        <dl className={s.result}>
          <div>
            <dt>Recomputed in browser</dt>
            <dd className="onchain">{state.recomputed}</dd>
          </div>
          <div>
            <dt>Stored report</dt>
            <dd data-ok={state.storedMatch || undefined}>{state.storedMatch ? "Matches" : "Mismatch"}</dd>
          </div>
          {onChainHash != null && (
            <div>
              <dt>On-chain mandate</dt>
              <dd data-ok={state.chainMatch || undefined}>
                {state.chainMatch ? "Matches" : "Mismatch"}
                <span className="onchain"> {onChainHash}</span>
              </dd>
            </div>
          )}
          {onChainHash == null && (
            <div>
              <dt>On-chain mandate</dt>
              <dd className="body-secondary">Approve the mandate to compare against the registry.</dd>
            </div>
          )}
        </dl>
      )}
      {state.kind === "error" && (
        <p className={s.error} role="alert">
          {state.message}
        </p>
      )}
    </div>
  );
}
