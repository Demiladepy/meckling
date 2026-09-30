import { test } from "node:test";
import assert from "node:assert/strict";
import { marketableLimit } from "./perpl.ts";
import { describeLimit, maxLeverage, priceCollar, priceDeviationBps, slippageWithinCollar, violationMessage } from "./rules.ts";

test("price collar copy says what happened and the limit", () => {
  assert.equal(describeLimit(priceCollar(1)), "orders within 1% of the market");
  assert.equal(
    violationMessage({ ruleIndex: 6, observed: 300n, limit: 100n }, priceCollar(1)),
    "Blocked: this order is priced 3% from the market. Your limit is 1%.",
  );
  assert.match(violationMessage({ ruleIndex: 6, observed: 2n ** 255n - 1n, limit: 100n }, priceCollar(1)), /no price limit/);
});

test("the contract's rounding would block a 1% sell against a 1% collar — the case that motivated the helper", () => {
  const mark = 835_995n; // real BTC mark on the mainnet fork, Sep 29
  assert.equal(priceDeviationBps(marketableLimit(mark, false, 100), mark), 101n);
});

test("orders built with slippageWithinCollar always pass the collar, buys and sells", () => {
  for (const pct of [0.05, 0.1, 0.5, 1, 2, 5]) {
    const rules = [maxLeverage(3), priceCollar(pct)];
    const collar = BigInt(Math.round(pct * 100));
    const slip = slippageWithinCollar(rules, 100);
    for (const mark of [835_995n, 273_001n, 999_999n, 12_345n]) {
      for (const isBuy of [true, false]) {
        const d = priceDeviationBps(marketableLimit(mark, isBuy, slip), mark);
        assert.ok(d <= collar, `pct ${pct} mark ${mark} buy ${isBuy}: ${d} > ${collar}`);
      }
    }
  }
});

test("without a collar the desired slippage is unchanged", () => {
  assert.equal(slippageWithinCollar([maxLeverage(3)], 100), 100);
});
