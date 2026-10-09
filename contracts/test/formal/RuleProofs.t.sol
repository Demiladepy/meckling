// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IVenue} from "../../src/venues/IVenue.sol";
import {RuleKind, Rule, Monitor, ExecContext} from "../../src/rules/RuleTypes.sol";
import {RuleEngine} from "../../src/rules/RuleEngine.sol";
import {MaxLeverageRule} from "../../src/rules/MaxLeverageRule.sol";
import {MaxNotionalPerMarketRule} from "../../src/rules/MaxNotionalPerMarketRule.sol";
import {MaxDrawdownRule} from "../../src/rules/MaxDrawdownRule.sol";
import {PriceCollarRule} from "../../src/rules/PriceCollarRule.sol";

/// Symbolic proofs of the rule libraries, run with Halmos (`halmos --contract RuleProofs`). Where a fuzzer samples random
/// inputs, each `check_` here holds for every input the solver can construct, all of them, within the
/// stated bounds. Forge doesn't run `check_` functions; Halmos runs them separately (docs/formal.md).
///
/// Bounds are stated with vm.assume and kept far above anything real: amounts below 2^64 collateral units (~1.8e13
/// AUSD) and limits below 2^32 bps. They keep the solver out of 256-bit multiplications the contracts never reach, not
/// out of any case that matters.
///
/// Four properties multiply two unknowns (rounding of the collar distance, monotonicity of the leverage and drawdown
/// limits); the solver doesn't finish those in 150 s, so they are fuzzed in test/RuleProperties.t.sol, not proven.
contract RuleProofs is Test {
    Monitor internal drawdownMonitor;

    uint256 internal constant BIG = 2 ** 64; // amounts, in collateral units
    uint256 internal constant LIMIT = 2 ** 32; // limits, in bps

    function _ctx(int256 preEq, uint256 preN, int256 postEq, uint256 postN)
        internal
        pure
        returns (ExecContext memory c)
    {
        c.pre.equity = preEq;
        c.pre.totalNotional = preN;
        c.post.equity = postEq;
        c.post.totalNotional = postN;
    }

    function _one(uint256 marketId, uint256 notional) internal pure returns (IVenue.MarketState[] memory ms) {
        ms = new IVenue.MarketState[](1);
        ms[0].marketId = marketId;
        ms[0].notional = notional;
    }

    // ------------------------------------------------------------ tighten-only (PRD 7.8 invariant 4)

    /// A rule can only be replaced by the same kind of rule, never with a changed reserved field, and never by an
    /// invalid one. Holds for every kind and every parameter.
    function check_tighteningKeepsKindAndValidity(
        uint8 k1,
        uint8 k2,
        uint256 a1,
        uint256 a2,
        uint256 a3,
        uint256 b1,
        uint256 b2,
        uint256 b3
    ) public pure {
        vm.assume(k1 <= uint8(type(RuleKind).max) && k2 <= uint8(type(RuleKind).max));
        Rule memory a = Rule(RuleKind(k1), a1, a2, a3);
        Rule memory b = Rule(RuleKind(k2), b1, b2, b3);
        if (RuleEngine.isTightening(a, b)) {
            assert(a.kind == b.kind);
            assert(a.p3 == b.p3);
            assert(RuleEngine.validate(b));
        }
    }

    // ------------------------------------------------------------ max leverage

    /// D3: a trade that does not grow total notional is never blocked, whatever equity did, so a price move can
    /// never trap an account in a position it can't reduce.
    function check_maxLeverage_neverBlocksAReducingTrade(
        uint256 p1,
        int256 preEq,
        uint256 preN,
        int256 postEq,
        uint256 postN
    ) public pure {
        vm.assume(p1 < LIMIT && preN < BIG && postN <= preN);
        vm.assume(postEq > -int256(BIG) && postEq < int256(BIG));
        (bool ok,,) = MaxLeverageRule.check(Rule(RuleKind.MaxLeverage, p1, 0, 0), _ctx(preEq, preN, postEq, postN));
        assert(ok);
    }

    /// The rule blocks exactly the trades that end over the limit and grew total notional. (That a stricter limit
    /// allows less follows from this formula; that step multiplies two unknowns, which the solver can't finish, so
    /// it is fuzzed in test/RuleProperties.t.sol instead.)
    function check_maxLeverage_blocksExactlyGrowthOverTheLimit(
        uint256 p1,
        int256 preEq,
        uint256 preN,
        int256 postEq,
        uint256 postN
    ) public pure {
        vm.assume(p1 < LIMIT && preN < BIG && postN < BIG);
        vm.assume(postEq > -int256(BIG) && postEq < int256(BIG));
        (bool ok,,) = MaxLeverageRule.check(Rule(RuleKind.MaxLeverage, p1, 0, 0), _ctx(preEq, preN, postEq, postN));
        uint256 eq = postEq > 0 ? uint256(postEq) : 0;
        assert(ok == !(postN * 10_000 > p1 * eq && postN > preN));
    }

    // ------------------------------------------------------------ max position size per market

    /// D3 for one market: shrinking (or not changing) that market's notional is never blocked.
    function check_maxNotional_neverBlocksAReducingTrade(uint256 marketId, uint256 limit, uint256 preN, uint256 postN)
        public
        pure
    {
        vm.assume(postN <= preN);
        ExecContext memory c;
        c.pre.markets = _one(marketId, preN);
        c.post.markets = _one(marketId, postN);
        (bool ok,,) = MaxNotionalPerMarketRule.check(Rule(RuleKind.MaxNotionalPerMarket, marketId, limit, 0), c);
        assert(ok);
    }

    /// Blocks exactly the trades that end over the limit and grew the market, no more, no less.
    function check_maxNotional_blocksExactlyGrowthOverTheLimit(
        uint256 marketId,
        uint256 limit,
        uint256 preN,
        uint256 postN
    ) public pure {
        ExecContext memory c;
        c.pre.markets = _one(marketId, preN);
        c.post.markets = _one(marketId, postN);
        (bool ok,,) = MaxNotionalPerMarketRule.check(Rule(RuleKind.MaxNotionalPerMarket, marketId, limit, 0), c);
        assert(ok == !(postN > limit && postN > preN));
    }

    // ------------------------------------------------------------ price collar (D14)

    /// No input makes the measurement revert; an order with no price is always unbounded.
    function check_deviation_neverRevertsAndMissingPriceIsUnbounded(uint256 price, uint256 mark) public pure {
        uint256 d = PriceCollarRule.deviationBps(price, mark);
        if (price == 0 || mark == 0) assert(d == type(uint256).max);
    }

    /// The collar allows exactly the distances within it, and a narrower collar allows less.
    function check_priceCollar_exactAndMonotone(uint256 strict, uint256 loose, uint256 deviation) public pure {
        vm.assume(strict <= loose);
        ExecContext memory c;
        c.maxPriceDeviationBps = deviation;
        (bool okStrict,,) = PriceCollarRule.check(Rule(RuleKind.PriceCollar, strict, 0, 0), c);
        (bool okLoose,,) = PriceCollarRule.check(Rule(RuleKind.PriceCollar, loose, 0, 0), c);
        assert(okStrict == (deviation <= strict));
        assert(!okStrict || okLoose);
    }

    // ------------------------------------------------------------ max drawdown (the market rule the bond insures)

    /// The breach condition is exactly the one both keepers compute off-chain (services/common isDrawdownBreached).
    function check_drawdown_matchesTheKeepers(uint256 peak, int256 equity, uint256 limit) public {
        vm.assume(peak > 0 && peak < BIG && equity > -int256(BIG) && equity < int256(BIG));
        vm.assume(limit > 0 && limit < 10_000);
        drawdownMonitor.w0 = peak;
        (bool ok,,) = MaxDrawdownRule.check(drawdownMonitor, Rule(RuleKind.MaxDrawdown, limit, 0, 0), equity);
        uint256 eq = equity > 0 ? uint256(equity) : 0;
        bool keeperSaysBreached = eq * 10_000 < peak * (10_000 - limit);
        assert(ok == !keeperSaysBreached);
    }
}
