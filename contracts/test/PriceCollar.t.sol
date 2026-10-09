// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateTestBase} from "./utils/MandateTestBase.sol";
import {MandateAccount} from "../src/MandateAccount.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {IPerplExchange} from "../src/venues/IPerplExchange.sol";
import {PriceCollarRule} from "../src/rules/PriceCollarRule.sol";
import {RuleKind, Rule, ExecContext} from "../src/rules/RuleTypes.sol";

/// Price collar (D14): an optional action rule that reverts any order opening or adding exposure at a limit price more
/// than p1 bps from the venue mark, SEC Rule 15c3-5's "erroneous order" price check, the Knight Capital failure mode.
contract PriceCollarTest is MandateTestBase {
    uint256 constant COLLAR_BPS = 100; // 1%
    uint256 constant COLLAR_INDEX = 6; // appended after the six default rules

    // ------------------------------------------------------------ the rule itself

    function _ctx(uint256 deviation) internal pure returns (ExecContext memory c) {
        c.maxPriceDeviationBps = deviation;
    }

    function test_validate() public pure {
        assertTrue(PriceCollarRule.validate(Rule(RuleKind.PriceCollar, 1, 0, 0)));
        assertTrue(PriceCollarRule.validate(Rule(RuleKind.PriceCollar, 10_000, 0, 0)));
        assertFalse(PriceCollarRule.validate(Rule(RuleKind.PriceCollar, 0, 0, 0)));
        assertFalse(PriceCollarRule.validate(Rule(RuleKind.PriceCollar, 10_001, 0, 0)));
        assertFalse(PriceCollarRule.validate(Rule(RuleKind.PriceCollar, 100, 1, 0)));
        assertFalse(PriceCollarRule.validate(Rule(RuleKind.PriceCollar, 100, 0, 1)));
    }

    function test_isTightening_onlyNarrower() public pure {
        Rule memory wide = Rule(RuleKind.PriceCollar, 200, 0, 0);
        assertTrue(PriceCollarRule.isTightening(wide, Rule(RuleKind.PriceCollar, 100, 0, 0)));
        assertTrue(PriceCollarRule.isTightening(wide, Rule(RuleKind.PriceCollar, 200, 0, 0)));
        assertFalse(PriceCollarRule.isTightening(wide, Rule(RuleKind.PriceCollar, 201, 0, 0)));
    }

    function test_check_atAndOverTheLimit() public pure {
        Rule memory r = Rule(RuleKind.PriceCollar, 100, 0, 0);
        (bool ok, int256 observed, int256 limit) = PriceCollarRule.check(r, _ctx(100));
        assertTrue(ok);
        assertEq(observed, 100);
        assertEq(limit, 100);
        (ok, observed,) = PriceCollarRule.check(r, _ctx(101));
        assertFalse(ok);
        assertEq(observed, 101);
    }

    function test_check_unknownPriceIsMaxAndBlocked() public pure {
        (bool ok, int256 observed,) =
            PriceCollarRule.check(Rule(RuleKind.PriceCollar, 10_000, 0, 0), _ctx(type(uint256).max));
        assertFalse(ok);
        assertEq(observed, type(int256).max);
    }

    // ------------------------------------------------------------ in a real execute

    function _collarRules() internal pure returns (Rule[] memory r) {
        Rule[] memory base = defaultRules();
        r = new Rule[](base.length + 1);
        for (uint256 i; i < base.length; ++i) {
            r[i] = base[i];
        }
        r[COLLAR_INDEX] = rule(RuleKind.PriceCollar, COLLAR_BPS, 0);
    }

    function _openLongAt(uint256 lot, uint256 price) internal view returns (MandateAccount.Call[] memory) {
        IPerplExchange.OrderDesc memory d = order(BTC, 0, lot);
        d.pricePNS = price;
        return orderCall(d);
    }

    function test_orderWithinCollarFills() public {
        setUpTrading(_collarRules());
        exec(_openLongAt(btcLots(500), BTC_MARK * 10_050 / 10_000)); // 0.5% through the mark
        assertGt(adapter.accountState(address(account)).totalNotional, 0);
    }

    function test_orderPastCollarReverts_withTheNumbers() public {
        setUpTrading(_collarRules());
        uint256 price = BTC_MARK * 10_300 / 10_000; // 3% through the mark
        vm.expectRevert(
            abi.encodeWithSelector(MandateAccount.MandateViolation.selector, COLLAR_INDEX, int256(300), int256(100))
        );
        exec(_openLongAt(btcLots(500), price));
    }

    function test_marketOrderWithNoPriceIsBlocked() public {
        setUpTrading(_collarRules());
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateAccount.MandateViolation.selector, COLLAR_INDEX, type(int256).max, int256(100)
            )
        );
        exec(_openLongAt(btcLots(500), 0));
    }

    function test_invalidMarkBlocksOpens() public {
        setUpTrading(_collarRules());
        perpl.setMarkValid(BTC, false);
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateAccount.MandateViolation.selector, COLLAR_INDEX, type(int256).max, int256(100)
            )
        );
        exec(_openLongAt(btcLots(500), BTC_MARK));
    }

    /// A collar must never trap a position: closes are exempt, whatever their price.
    function test_closesAreExempt() public {
        setUpTrading(_collarRules());
        exec(_openLongAt(btcLots(500), BTC_MARK));
        IPerplExchange.OrderDesc memory d = order(BTC, 2, btcLots(500)); // close long
        d.pricePNS = BTC_MARK / 2; // 50% below the mark
        exec(orderCall(d));
        assertEq(adapter.accountState(address(account)).totalNotional, 0);
    }

    function test_withoutACollarFarPricesAreNotChecked() public {
        setUpTrading(defaultRules());
        exec(_openLongAt(btcLots(500), BTC_MARK * 2)); // 100% through the mark, fills at the mark
        assertGt(adapter.accountState(address(account)).totalNotional, 0);
    }

    // ------------------------------------------------------------ the adapter's measurement

    function test_adapter_reportsTheWorstOrderInABatch() public {
        setUpTrading(_collarRules());
        IPerplExchange.OrderDesc[] memory descs = new IPerplExchange.OrderDesc[](3);
        descs[0] = order(BTC, 0, 1);
        descs[0].pricePNS = BTC_MARK * 10_020 / 10_000; // 20 bps
        descs[1] = order(BTC, 1, 1); // open short
        descs[1].pricePNS = BTC_MARK * 9_950 / 10_000; // 50 bps below
        descs[2] = order(BTC, 2, 1); // close: ignored
        descs[2].pricePNS = 1;
        bytes memory data = abi.encodeCall(IPerplExchange.execOrders, (descs, true));
        assertEq(adapter.orderPriceDeviationBps(address(account), data), 50);
    }

    function test_adapter_nonOrderCallsMeasureZero() public view {
        bytes memory data = abi.encodeCall(IPerplExchange.depositCollateral, (1e6));
        assertEq(adapter.orderPriceDeviationBps(address(account), data), 0);
    }

    function test_adapter_roundsUp() public {
        setUpTrading(_collarRules());
        IPerplExchange.OrderDesc memory d = order(BTC, 0, 1);
        d.pricePNS = BTC_MARK + 1; // a hair over the mark: 0.0117... bps must not round down to 0
        IPerplExchange.OrderDesc[] memory descs = new IPerplExchange.OrderDesc[](1);
        descs[0] = d;
        assertEq(
            adapter.orderPriceDeviationBps(address(account), abi.encodeCall(IPerplExchange.execOrders, (descs, true))),
            1
        );
    }

    // ------------------------------------------------------------ the registry

    function test_registry_acceptsAndTightensTheCollar() public {
        createMandate(_collarRules());
        vm.startPrank(backer);
        registry.tightenRule(mandateId, COLLAR_INDEX, rule(RuleKind.PriceCollar, 50, 0));
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NotTightening.selector, COLLAR_INDEX));
        registry.tightenRule(mandateId, COLLAR_INDEX, rule(RuleKind.PriceCollar, 60, 0));
        vm.stopPrank();
    }
}
