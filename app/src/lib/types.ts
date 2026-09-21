import type { Hex } from "viem";
import type { Rule } from "@mandate/common";
import type { UnderwritingReport } from "underwriter";

export interface UnderwriteResponse {
  report: UnderwritingReport;
  reportHash: Hex;
  rules: Rule[];
}

type RuleJson = { kind: number; p1: string; p2: string; p3: string };

/** Rules come over JSON as strings; restore bigints. */
export function parseUnderwrite(body: { report: UnderwritingReport; reportHash: Hex; rules: RuleJson[] }): UnderwriteResponse {
  return {
    report: body.report,
    reportHash: body.reportHash,
    rules: body.rules.map((r) => ({ kind: r.kind as Rule["kind"], p1: BigInt(r.p1), p2: BigInt(r.p2), p3: BigInt(r.p3) })),
  };
}
