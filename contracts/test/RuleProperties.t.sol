// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {RuleKind, Rule, Monitor, ExecContext} from "../src/rules/RuleTypes.sol";
import {MaxLeverageRule} from "../src/rules/MaxLeverageRule.sol";
import {MaxDrawdownRule} from "../src/rules/MaxDrawdownRule.sol";
import {PriceCollarRule} from "../src/rules/PriceCollarRule.sol";

/// The four rule properties the symbolic prover can't finish (each multiplies two unknowns; see
/// test/formal/RuleProofs.t.sol). Fuzzed here instead, so they are tested on every run, not proven.
contract RulePropertiesTest is Test {
    Monitor internal drawdownMonitor;

    uint256 internal constant BIG = 2 ** 64; // amounts, in collateral units
    uint256 internal constant PRICE = 2 ** 40; // venue price units
    uint256 internal constant LIMIT = 2 ** 32; // limits, in bps

    /// The collar distance never under-reports (a price over the limit can't slip through) and is at most 1 bps over.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_deviationIsTightAndNeverUnderReports(uint256 price, uint256 mark) public pure {
        price = bound(price, 1, PRICE - 1);
        mark = bound(mark, 1, PRICE - 1);
        uint256 d = PriceCollarRule.deviationBps(price, mark);
        uint256 diff = price > mark ? price - mark : mark - price;
        assertGe(d * mark, diff * 10_000, "never rounds down");
        assertLt(d * mark, diff * 10_000 + mark, "at most one bps up");
    }

    /// Anything a stricter leverage limit allows, the looser one allowed too.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_stricterLeverageLimitAllowsLess(
        uint256 strict,
        uint256 loose,
        int256 postEq,
        uint256 preN,
        uint256 postN
    ) public pure {
        loose = bound(loose, 0, LIMIT - 1);
        strict = bound(strict, 0, loose);
        postEq = bound(postEq, -int256(BIG) + 1, int256(BIG) - 1);
        preN = bound(preN, 0, BIG - 1);
        postN = bound(postN, 0, BIG - 1);
        ExecContext memory c;
        c.pre.totalNotional = preN;
        c.post.equity = postEq;
        c.post.totalNotional = postN;
        (bool okStrict,,) = MaxLeverageRule.check(Rule(RuleKind.MaxLeverage, strict, 0, 0), c);
        (bool okLoose,,) = MaxLeverageRule.check(Rule(RuleKind.MaxLeverage, loose, 0, 0), c);
        assertTrue(!okStrict || okLoose);
    }

    /// Equity at or above its peak is never a drawdown breach, for any limit.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_noDrawdownBreachAtOrAbovePeak(uint256 peak, uint256 equity, uint256 limit) public {
        peak = bound(peak, 1, BIG - 1);
        equity = bound(equity, peak, BIG - 1);
        limit = bound(limit, 1, 9_999);
        drawdownMonitor.w0 = peak;
        (bool ok,,) = MaxDrawdownRule.check(drawdownMonitor, Rule(RuleKind.MaxDrawdown, limit, 0, 0), int256(equity));
        assertTrue(ok);
    }

    /// A tighter drawdown floor flags at least whatever a looser one does, so tightening only adds protection.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_stricterDrawdownLimitFlagsMore(uint256 peak, int256 equity, uint256 strict, uint256 loose)
        public
    {
        peak = bound(peak, 1, BIG - 1);
        equity = bound(equity, -int256(BIG) + 1, int256(BIG) - 1);
        loose = bound(loose, 1, 9_999);
        strict = bound(strict, 1, loose);
        drawdownMonitor.w0 = peak;
        (bool okStrict,,) = MaxDrawdownRule.check(drawdownMonitor, Rule(RuleKind.MaxDrawdown, strict, 0, 0), equity);
        (bool okLoose,,) = MaxDrawdownRule.check(drawdownMonitor, Rule(RuleKind.MaxDrawdown, loose, 0, 0), equity);
        assertTrue(!okStrict || okLoose);
    }
}
