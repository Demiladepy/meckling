// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateTestBase} from "./utils/MandateTestBase.sol";
import {BondVault} from "../src/BondVault.sol";
import {OracleGuard, IAggregatorV3} from "../src/OracleGuard.sol";
import {MandateAccount} from "../src/MandateAccount.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {IVenue} from "../src/venues/IVenue.sol";

/// The market-rule path (PRD 7.5 and 7.6): drawdown breaches, the oracle guard, unwinding, disputes and slashing.
contract MarketRulesTest is MandateTestBase {
    function setUp() public override {
        super.setUp();
        setUpTrading(defaultRules());
        postBond(200);
    }

    /// Opens a BTC long, then drops BTC so equity falls `pct` percent below its peak.
    function _openThenDrop(uint256 pct) internal {
        exec(openLong(BTC, btcLots(1_000))); // 1x, peak = 1,000
        // equity moves 1:1 with the $1,000 position, so a pct drop in BTC is a pct drawdown.
        setMarkAndFeed(BTC, BTC_MARK * (100 - pct) / 100);
    }

    // ---------------------------------------------------------------- oracle guard

    function test_guardTrustsAgreeingMark() public {
        (bool ok, uint256 mark, uint256 ref) = guard.markIsTrusted(address(account), BTC);
        assertTrue(ok);
        assertEq(mark, 85_000e18);
        assertEq(ref, 85_000e18);
        assertTrue(guard.accountMarksTrusted(address(account)));
    }

    function test_guardRejectsManipulatedMark() public {
        exec(openLong(BTC, btcLots(100)));
        perpl.setMark(BTC, BTC_MARK * 90 / 100); // venue mark moves, the feed does not
        (bool ok,,) = guard.markIsTrusted(address(account), BTC);
        assertFalse(ok);
        assertFalse(guard.accountMarksTrusted(address(account)));
    }

    function test_guardRejectsStaleFeed() public {
        exec(openLong(BTC, btcLots(100)));
        vm.warp(block.timestamp + 61); // past maxAgeSec
        (bool ok,,) = guard.markIsTrusted(address(account), BTC);
        assertFalse(ok);
    }

    function test_guardRejectsUnknownMarketAndInvalidMark() public {
        (bool ok,,) = guard.markIsTrusted(address(account), MON); // no feed configured
        assertFalse(ok);
        vm.expectRevert(abi.encodeWithSelector(OracleGuard.NoFeed.selector, MON));
        guard.referencePrice(MON);
    }

    function test_accountWithNoPositionsIsTrusted() public view {
        assertTrue(guard.accountMarksTrusted(address(account)));
    }

    function test_onlyOwnerConfiguresFeeds() public {
        vm.prank(stranger);
        vm.expectRevert();
        guard.setFeed(BTC, IAggregatorV3(address(btcFeed)), 60, 50);
        vm.prank(admin);
        vm.expectRevert(OracleGuard.BadConfig.selector);
        guard.setFeed(BTC, IAggregatorV3(address(btcFeed)), 0, 50);
    }

    // ---------------------------------------------------------------- flagging

    function test_flagBreachUnwindsAndEntersCloseOnly() public {
        _openThenDrop(6); // 6% drawdown against a 5% limit

        vm.expectEmit(true, true, false, false, address(vault));
        emit BondVault.BreachFlagged(0, address(account), 5, 0, 0, 0);
        vm.prank(keeper);
        uint256 id = vault.flagBreach(address(account), 5);

        BondVault.Breach memory b = vault.getBreach(id);
        assertEq(b.account, address(account));
        assertEq(b.ruleIndex, 5);
        assertApproxEqAbs(uint256(b.observed), 600, 5, "6% drawdown in bps");
        assertEq(b.limit, 500);
        assertEq(b.peakEquity, 1_000e6);
        assertEq(b.reporter, keeper);

        // The position is closed and the account is close-only.
        assertEq(adapter.accountState(address(account)).markets.length, 0, "unwound");
        assertTrue(account.breached());
        assertTrue(account.closeOnly());
        vm.expectRevert(MandateAccount.CloseOnlyMode.selector);
        exec(openLong(BTC, 10));
    }

    function test_flagRevertsWhenRuleHolds() public {
        _openThenDrop(3); // inside the 5% limit
        vm.expectRevert(BondVault.NoBreach.selector);
        vault.flagBreach(address(account), 5);
    }

    function test_flagRevertsOnActionRuleIndex() public {
        _openThenDrop(6);
        vm.expectRevert(BondVault.NotMarketRule.selector);
        vault.flagBreach(address(account), 0); // MaxLeverage is an action rule
        vm.expectRevert(BondVault.NotMarketRule.selector);
        vault.flagBreach(address(account), 99);
    }

    function test_flagRevertsWhenMarksAreNotTrusted() public {
        exec(openLong(BTC, btcLots(1_000)));
        perpl.setMark(BTC, BTC_MARK * 80 / 100); // mark alone collapses: a manipulated feed, not a real drawdown
        vm.expectRevert(BondVault.MarksNotTrusted.selector);
        vault.flagBreach(address(account), 5);
    }

    function test_cannotFlagTwice() public {
        _openThenDrop(6);
        vault.flagBreach(address(account), 5);
        vm.expectRevert(BondVault.BreachPending.selector);
        vault.flagBreach(address(account), 5);
    }

    // ---------------------------------------------------------------- slashing

    function test_slashPaysBackerAfterWindow() public {
        _openThenDrop(6);
        uint256 id = vault.flagBreach(address(account), 5);
        BondVault.Breach memory b = vault.getBreach(id);
        uint256 loss = b.peakEquity - uint256(b.equityAtFlag);

        vm.expectRevert(BondVault.DisputeWindowOpen.selector);
        vault.slash(id);

        vm.roll(block.number + 601); // dispute window is 600 blocks
        uint256 before = ausd.balanceOf(backer);
        vault.slash(id);
        assertEq(ausd.balanceOf(backer) - before, loss, "backer paid the loss from peak");
        assertEq(vault.bondOf(address(account)), 200e6 - loss);

        vm.expectRevert(BondVault.AlreadySlashed.selector);
        vault.slash(id);
    }

    function test_slashIsCappedAtTheBond() public {
        // A bond smaller than the loss pays out everything it has, and no more.
        vm.startPrank(operatorAddr);
        vault.postBond(address(account), 0);
        vm.stopPrank();
        _openThenDrop(40); // ~$400 loss against a $200 bond
        uint256 id = vault.flagBreach(address(account), 5);
        vm.roll(block.number + 601);
        uint256 before = ausd.balanceOf(backer);
        vault.slash(id);
        assertEq(ausd.balanceOf(backer) - before, 200e6, "capped at the bond");
        assertEq(vault.bondOf(address(account)), 0);
    }

    // ---------------------------------------------------------------- disputes

    function test_disputeThenUpheldAllowsSlash() public {
        _openThenDrop(6);
        uint256 id = vault.flagBreach(address(account), 5);

        vm.prank(stranger);
        vm.expectRevert(BondVault.NotOperator.selector);
        vault.dispute(id, "not me");

        vm.prank(operatorAddr);
        vault.dispute(id, "the feed was wrong");
        vm.expectRevert(BondVault.DisputeUnresolved.selector);
        vault.slash(id);

        vm.prank(stranger);
        vm.expectRevert(BondVault.NotArbiter.selector);
        vault.resolveDispute(id, true);

        vm.prank(arbiter);
        vault.resolveDispute(id, true);
        uint256 before = ausd.balanceOf(backer);
        vault.slash(id); // an upheld dispute needs no further wait
        assertGt(ausd.balanceOf(backer), before);
    }

    function test_rejectedDisputeKeepsTheBond() public {
        _openThenDrop(6);
        uint256 id = vault.flagBreach(address(account), 5);
        vm.prank(operatorAddr);
        vault.dispute(id, "oracle glitch");
        vm.prank(arbiter);
        vault.resolveDispute(id, false);

        vm.expectRevert(BondVault.NoBreach.selector);
        vault.slash(id);
        assertEq(vault.bondOf(address(account)), 200e6, "bond untouched");
        assertEq(vault.openBreachOf(address(account)), 0, "account is clear again");
    }

    function test_disputeWindowCloses() public {
        _openThenDrop(6);
        uint256 id = vault.flagBreach(address(account), 5);
        vm.roll(block.number + 601);
        vm.prank(operatorAddr);
        vm.expectRevert(BondVault.DisputeWindowClosed.selector);
        vault.dispute(id, "too late");
    }

    // ---------------------------------------------------------------- bonds

    function test_bondWithdrawalRules() public {
        vm.prank(stranger);
        vm.expectRevert(BondVault.NotOperator.selector);
        vault.withdrawBond(address(account));

        vm.prank(operatorAddr);
        vm.expectRevert(BondVault.MandateActive.selector);
        vault.withdrawBond(address(account));

        vm.prank(backer);
        registry.deactivate(mandateId);
        vm.prank(operatorAddr);
        vault.withdrawBond(address(account));
        assertEq(ausd.balanceOf(operatorAddr), 200e6);
    }

    function test_bondCannotLeaveWhileABreachIsPending() public {
        _openThenDrop(6);
        vault.flagBreach(address(account), 5);
        vm.prank(backer);
        registry.deactivate(mandateId);
        vm.prank(operatorAddr);
        vm.expectRevert(BondVault.BreachPending.selector);
        vault.withdrawBond(address(account));
    }

    function test_unwindOnlyFromBondVault() public {
        vm.prank(stranger);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.unwind(300);
        vm.prank(backer);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.unwind(300);
    }

    function test_closeAllEncodesEveryOpenPosition() public {
        exec(openLong(BTC, btcLots(500)));
        exec(openLong(ETH, ethLots(500)));
        (address[] memory targets, bytes[] memory datas) = adapter.encodeCloseAll(address(account), 300);
        assertEq(targets.length, 1, "one batched execOrders call");
        assertEq(targets[0], address(perpl));
        assertGt(datas[0].length, 4);

        _openThenDrop(0); // keep positions, no price move
        setMarkAndFeed(BTC, BTC_MARK * 94 / 100);
        uint256 id = vault.flagBreach(address(account), 5);
        assertEq(adapter.accountState(address(account)).markets.length, 0, "both markets closed");
        assertEq(vault.getBreach(id).ruleIndex, 5);
    }
}
