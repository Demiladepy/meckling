import { test } from "node:test";
import assert from "node:assert/strict";
import { getNetwork, RuleKind, usdToCns } from "@mandate/common";
import { fixtureClient } from "./fixtures.ts";
import { underwrite, canonicalJson, hashReport, score, REGIME_TABLE } from "./underwrite.ts";

const net = getNetwork("mainnet");
const now = new Date("2026-09-21T12:00:00Z");

test("net-short smart money with outflows makes BTC risk-off", async () => {
  const { report, rules } = await underwrite({ nansen: fixtureClient(), net, symbols: ["BTC"], baseNotionalUsd: 1000, source: "fixture", now });
  const btc = report.markets[0]!;
  assert.equal(btc.regime, "risk-off");
  assert.ok(btc.score < -0.25);
  assert.equal(report.mandateRegime, "risk-off");
  // Table: risk-off => 1.5x, 0.4 x base, 600-block cooldown.
  assert.equal(rules[0]!.kind, RuleKind.MaxLeverage);
  assert.equal(rules[0]!.p1, 15_000n);
  assert.equal(rules[1]!.p2, usdToCns(400));
  const cooldown = rules.find((r) => r.kind === RuleKind.LossCooldown)!;
  assert.equal(cooldown.p2, 600n);
  assert.ok(btc.reasons.some((r) => r.includes("net short BTC")));
});

test("account-wide limits take the strictest market; per-market notional uses each market's regime", async () => {
  const { report, rules } = await underwrite({ nansen: fixtureClient(), net, symbols: ["BTC", "MON"], baseNotionalUsd: 1000, source: "fixture", now });
  const mon = report.markets.find((m) => m.symbol === "MON")!;
  assert.equal(mon.regime, "risk-on");
  assert.equal(report.mandateRegime, "risk-off");
  const notionals = rules.filter((r) => r.kind === RuleKind.MaxNotionalPerMarket);
  assert.deepEqual(
    notionals.map((r) => [r.p1, r.p2]),
    [
      [1n, usdToCns(1000 * REGIME_TABLE["risk-off"].notionalFactor)],
      [10n, usdToCns(1000 * REGIME_TABLE["risk-on"].notionalFactor)],
    ],
  );
  const allowed = rules.find((r) => r.kind === RuleKind.AllowedMarkets)!;
  assert.equal(allowed.p1, (1n << 1n) | (1n << 10n));
});

test("signals outside the plan are marked unavailable, not guessed", async () => {
  const { report } = await underwrite({
    nansen: fixtureClient(["/tgm/perp-positions", "/smart-money/netflow"]),
    net,
    symbols: ["BTC"],
    baseNotionalUsd: 1000,
    source: "fixture",
    now,
  });
  const btc = report.markets[0]!;
  assert.equal(btc.positioning.available, false);
  assert.match(btc.positioning.unavailableReason!, /403/);
  assert.equal(btc.regime, "neutral");
  assert.ok(btc.reasons.some((r) => r.includes("defaults to neutral")));
});

test("concentration pushes toward risk-off", () => {
  const base = score("ETH", 20, { available: false }, { available: false }, { available: true, data: { token: "x", top10OwnershipPct: 80, smartMoneyHolders: 1 } });
  assert.equal(base.score, -0.2);
});

test("report hash is canonical and stable", async () => {
  const a = await underwrite({ nansen: fixtureClient(), net, symbols: ["BTC", "ETH"], baseNotionalUsd: 1000, source: "fixture", now });
  const b = await underwrite({ nansen: fixtureClient(), net, symbols: ["BTC", "ETH"], baseNotionalUsd: 1000, source: "fixture", now });
  assert.equal(a.reportHash, b.reportHash);
  assert.equal(a.reportHash, hashReport(JSON.parse(canonicalJson(a.report))));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
});
