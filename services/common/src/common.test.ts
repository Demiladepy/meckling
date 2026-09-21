import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeErrorResult } from "viem";
import { mandateAccountAbi } from "./abis.ts";
import { getNetwork, marketBySymbol } from "./networks.ts";
import { notionalCns, usdToLots, marketableLimit, usdToCns, orderDesc, OrderType } from "./perpl.ts";
import {
  decodeViolation,
  violationMessage,
  maxLeverage,
  allowedMarkets,
  lossCooldown,
  describeLimit,
  maxNotional,
} from "./rules.ts";

const net = getNetwork("mainnet");
const btc = marketBySymbol(net, "BTC");

test("notional matches the on-chain fork observation", () => {
  // Fork test (docs/spikes.md S1): 20 lots at 850,024 PNS = $17.000480
  assert.equal(notionalCns(btc, 20n, 850_024n), 17_000_480n);
});

test("usdToLots never exceeds the requested notional", () => {
  const lots = usdToLots(btc, 1000, 85_000);
  assert.equal(lots, 1176n);
  assert.ok(notionalCns(btc, lots, 850_000n) <= usdToCns(1000));
});

test("marketable limits move in the fill direction", () => {
  assert.equal(marketableLimit(850_000n, true, 100), 858_500n);
  assert.equal(marketableLimit(850_000n, false, 100), 841_500n);
});

test("order descs are immediate by default (decision D1)", () => {
  const d = orderDesc({ market: btc, type: OrderType.OpenLong, lots: 10n, limitPricePNS: 1n });
  assert.equal(d.immediateOrCancel, true);
  assert.equal(d.postOnly, false);
  assert.equal(d.perpId, 1n);
});

test("decodes MandateViolation and writes PRD 11.2 copy", () => {
  const data = encodeErrorResult({ abi: mandateAccountAbi, errorName: "MandateViolation", args: [0n, 42_000n, 30_000n] });
  const v = decodeViolation(data);
  assert.deepEqual(v, { ruleIndex: 0, observed: 42_000n, limit: 30_000n });
  assert.equal(
    violationMessage(v!, maxLeverage(3), net),
    "Blocked: this trade would put you at 4.2x leverage. Your limit is 3x.",
  );
});

test("other errors are not violations", () => {
  const data = encodeErrorResult({ abi: mandateAccountAbi, errorName: "CloseOnlyMode" });
  assert.equal(decodeViolation(data), undefined);
  assert.equal(decodeViolation(undefined), undefined);
});

test("rule descriptions", () => {
  assert.equal(describeLimit(allowedMarkets([1, 20]), net), "BTC, ETH");
  assert.equal(describeLimit(lossCooldown(usdToCns(10), 150), net), "150 blocks after a $10 loss");
  assert.equal(describeLimit(maxNotional(1, usdToCns(2000)), net), "$2,000 on BTC");
  const v = { ruleIndex: 4, observed: 10n, limit: 150n };
  assert.equal(violationMessage(v, lossCooldown(usdToCns(10), 150), net), "Blocked: you're in a loss cooldown. 140 blocks left of 150.");
});
