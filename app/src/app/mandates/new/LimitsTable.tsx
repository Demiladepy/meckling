"use client";

import { useEffect, useMemo, useState } from "react";
import { RuleKind, cnsToUsd, describeLimit, usdToCns, type MarketInfo, type Rule } from "@mandate/common";
import s from "./page.module.css";

export interface Draft {
  rules: Rule[];
  needsOverride: boolean;
  overrideAccepted: boolean;
}

/** The editable number for each rule kind, in the unit a backer thinks in. */
function toValue(r: Rule): string {
  switch (r.kind) {
    case RuleKind.MaxLeverage:
      return String(Number(r.p1) / 10_000);
    case RuleKind.MaxNotionalPerMarket:
      return String(cnsToUsd(r.p2));
    case RuleKind.OrderRateLimit:
      return String(r.p1);
    case RuleKind.LossCooldown:
      return String(r.p2);
    case RuleKind.MaxDrawdown:
      return String(Number(r.p1) / 100);
    default:
      return "";
  }
}

function fromValue(r: Rule, v: number): Rule {
  switch (r.kind) {
    case RuleKind.MaxLeverage:
      return { ...r, p1: BigInt(Math.round(v * 10_000)) };
    case RuleKind.MaxNotionalPerMarket:
      return { ...r, p2: usdToCns(v) };
    case RuleKind.OrderRateLimit:
      return { ...r, p1: BigInt(Math.round(v)) };
    case RuleKind.LossCooldown:
      return { ...r, p2: BigInt(Math.round(v)) };
    case RuleKind.MaxDrawdown:
      return { ...r, p1: BigInt(Math.round(v * 100)) };
    default:
      return r;
  }
}

const UNIT: Partial<Record<RuleKind, { prefix?: string; suffix?: string }>> = {
  [RuleKind.MaxLeverage]: { suffix: "x" },
  [RuleKind.MaxNotionalPerMarket]: { prefix: "$" },
  [RuleKind.OrderRateLimit]: { suffix: "orders" },
  [RuleKind.LossCooldown]: { suffix: "blocks" },
  [RuleKind.MaxDrawdown]: { suffix: "%" },
};

/** Looser than the proposal? For cooldowns a shorter wait is looser; for everything else a bigger number is. */
function isLooser(r: Rule, proposed: Rule): boolean {
  switch (r.kind) {
    case RuleKind.LossCooldown:
      return r.p2 < proposed.p2;
    case RuleKind.MaxNotionalPerMarket:
      return r.p2 > proposed.p2;
    default:
      return r.p1 > proposed.p1;
  }
}

export function LimitsTable(props: {
  proposal: Rule[];
  labels: string[];
  /** One Nansen signal line per row — evidence → limit for judges. */
  because?: string[];
  markets: MarketInfo[];
  draft?: Draft;
  onChange: (d: Draft) => void;
  disabled: boolean;
}) {
  const { proposal, labels, because, onChange, disabled } = props;
  const [values, setValues] = useState(() => proposal.map(toValue));
  const [accepted, setAccepted] = useState(false);
  useEffect(() => setValues(proposal.map(toValue)), [proposal]);

  const rules = useMemo(
    () =>
      proposal.map((r, i) => {
        const v = Number(values[i]);
        return Number.isFinite(v) && v > 0 && UNIT[r.kind] ? fromValue(r, v) : r;
      }),
    [proposal, values],
  );
  const looser = rules.map((r, i) => isLooser(r, proposal[i]!));
  const needsOverride = looser.some(Boolean);

  useEffect(() => onChange({ rules, needsOverride, overrideAccepted: accepted }), [rules, needsOverride, accepted, onChange]);

  const net = { key: "local", markets: props.markets } as never;

  return (
    <div className="card">
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">Limit</th>
            <th scope="col">Nansen proposal</th>
            <th scope="col">Your mandate</th>
          </tr>
        </thead>
        <tbody>
          {proposal.map((r, i) => {
            const unit = UNIT[r.kind];
            const why = because?.[i];
            return (
              <tr key={i}>
                <th scope="row">
                  <div className={s.limitLabel}>
                    <span>{labels[i]}</span>
                    {why && <span className={s.because}>{why}</span>}
                  </div>
                </th>
                <td className="body-secondary">{describeLimit(r, net)}</td>
                <td>
                  {unit ? (
                    <label className={s.cellInput} data-looser={looser[i] || undefined}>
                      <span className="visually-hidden">{labels[i]}</span>
                      {unit.prefix && <span aria-hidden>{unit.prefix}</span>}
                      <input
                        inputMode="decimal"
                        value={values[i]}
                        disabled={disabled}
                        onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, "") : x)))}
                      />
                      {unit.suffix && <span aria-hidden>{unit.suffix}</span>}
                    </label>
                  ) : (
                    <span>{describeLimit(r, net)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {needsOverride && (
        <div className={s.override} role="alert">
          <p>
            This loosens what Nansen proposed. The stored fingerprint still records the original, so anyone can see what
            you changed.
          </p>
          <label>
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> Override the
            proposal
          </label>
        </div>
      )}
    </div>
  );
}
