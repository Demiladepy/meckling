// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateTestBase} from "./utils/MandateTestBase.sol";
import {MandateAccount} from "../src/MandateAccount.sol";
import {IPerplExchange} from "../src/venues/IPerplExchange.sol";
import {IVenue} from "../src/venues/IVenue.sol";
import {Rule, RuleKind, Monitor} from "../src/rules/RuleTypes.sol";

contract MandateAccountTest is MandateTestBase {
    function setUp() public override {
        super.setUp();
        setUpTrading(defaultRules());
    }

    // ------------------------------------------------------------ happy path

    function test_tradeWithinLimitsFills() public {
        exec(openLong(BTC, btcLots(1_500))); // 1.5x
        IVenue.AccountState memory s = adapter.accountState(address(account));
        assertEq(s.markets.length, 1);
        assertEq(s.markets[0].marketId, BTC);
        assertApproxEqAbs(s.totalNotional, 1_500e6, 1e6);
        assertEq(s.equity, 1_000e6);
    }

    function test_executeEmitsExecuted() public {
        vm.expectEmit(true, false, false, false, address(account));
        emit MandateAccount.Executed(address(account), block.number, 0, 0);
        exec(openLong(BTC, btcLots(500)));
    }

    // ------------------------------------------------------------ MaxLeverage

    function test_twelveXAgainstThreeXReverts() public {
        // 12x = $12,000 notional on $1,000 equity; mark ETH to avoid the BTC notional cap firing first.
        uint256 lots = ethLots(12_000); // ETH lots (1e-3 ETH) worth ~$12,000
        MandateAccount.Call[] memory calls = openLong(ETH, lots);
        uint256 expectedNotional = lots * 273_000 * 1e6 / 1e5;
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateAccount.MandateViolation.selector, 0, int256(expectedNotional * 10_000 / 1_000e6), int256(30_000)
            )
        );
        exec(calls);
    }

    function test_leverageExactlyAtLimitPasses() public {
        uint256 lots = ethLots(3_000);
        exec(openLong(ETH, lots));
    }

    function test_reduceAllowedWhenOverLeverageFromPriceMove() public {
        exec(openLong(ETH, ethLots(2_900))); // ~2.9x
        perpl.setMark(ETH, 250_000); // equity drops, leverage goes above 3x without the agent acting
        IVenue.AccountState memory s = adapter.accountState(address(account));
        assertGt(s.totalNotional * 10_000, 30_000 * uint256(s.equity));
        // Adding must revert...
        vm.expectPartialRevert(MandateAccount.MandateViolation.selector);
        exec(openLong(ETH, 100));
        // ...but reducing passes even though leverage stays above the limit afterwards.
        exec(orderCall(order(ETH, 2, 100)));
        s = adapter.accountState(address(account));
        assertGt(s.totalNotional * 10_000, 30_000 * uint256(s.equity));
    }

    // ------------------------------------------------------------ MaxNotionalPerMarket

    function test_btcNotionalCap() public {
        exec(openLong(BTC, btcLots(1_900)));
        vm.expectPartialRevert(MandateAccount.MandateViolation.selector);
        exec(openLong(BTC, btcLots(200)));
    }

    // ------------------------------------------------------------ AllowedMarkets

    function test_disallowedMarketReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.MandateViolation.selector, 2, int256(MON), int256(-1)));
        exec(openLong(MON, 1_000)); // 1,000 MON, ~$25
    }

    // ------------------------------------------------------------ OrderRateLimit

    function test_orderRateLimitWindow() public {
        for (uint256 i; i < 5; ++i) {
            exec(openLong(BTC, 10));
        }
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.MandateViolation.selector, 3, int256(6), int256(5)));
        exec(openLong(BTC, 10));
        vm.roll(block.number + 20);
        exec(openLong(BTC, 10)); // new window
        assertEq(account.monitor(3).w1, 1);
    }

    function test_cancelsDoNotCountAsOrders() public {
        for (uint256 i; i < 10; ++i) {
            exec(orderCall(order(BTC, 4, 0)));
        }
        assertEq(account.monitor(3).w1, 0);
    }

    // ------------------------------------------------------------ LossCooldown

    function test_revengeTradeBlockedDuringCooldown() public {
        exec(openLong(BTC, btcLots(1_000)));
        perpl.setMark(BTC, BTC_MARK * 97 / 100); // -3% => ~-$30 unrealized
        exec(closeLong(BTC, btcLots(1_000))); // realizes the loss
        assertEq(account.monitor(4).w0, block.number + 1);

        vm.roll(block.number + 10);
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.MandateViolation.selector, 4, int256(10), int256(150)));
        exec(openLong(BTC, 10));

        vm.roll(block.number + 140); // 150 blocks after the loss
        exec(openLong(BTC, 10));
    }

    function test_smallLossDoesNotTriggerCooldown() public {
        exec(openLong(BTC, btcLots(100)));
        perpl.setMark(BTC, BTC_MARK * 99 / 100); // -$1
        exec(closeLong(BTC, btcLots(100)));
        assertEq(account.monitor(4).w0, 0);
        exec(openLong(BTC, 10));
    }

    function test_profitDoesNotTriggerCooldown() public {
        exec(openLong(BTC, btcLots(1_000)));
        perpl.setMark(BTC, BTC_MARK * 105 / 100);
        exec(closeLong(BTC, btcLots(1_000)));
        assertEq(account.monitor(4).w0, 0);
    }

    function test_closingAllowedDuringCooldown() public {
        exec(openLong(BTC, btcLots(1_000)));
        exec(openLong(ETH, 500)); // 0.5 ETH, total ~2.4x
        perpl.setMark(BTC, BTC_MARK * 97 / 100);
        exec(closeLong(BTC, btcLots(1_000)));
        exec(orderCall(order(ETH, 2, 500))); // closing ETH during the cooldown is fine
    }

    // ------------------------------------------------------------ MaxDrawdown monitor

    function test_equityPeakTracksExecutesAndPoke() public {
        exec(openLong(BTC, btcLots(1_000)));
        assertEq(account.monitor(5).w0, 1_000e6);
        perpl.setMark(BTC, BTC_MARK * 110 / 100);
        vm.prank(stranger);
        account.poke();
        assertApproxEqAbs(account.monitor(5).w0, 1_100e6, 1e6);
        perpl.setMark(BTC, BTC_MARK);
        account.poke();
        assertApproxEqAbs(account.monitor(5).w0, 1_100e6, 1e6, "peak never decreases");
    }

    // ------------------------------------------------------------ call allowlist

    function test_refusesOrderForwarding() public {
        MandateAccount.Call[] memory calls = new MandateAccount.Call[](1);
        calls[0] = MandateAccount.Call(address(perpl), abi.encodeCall(IPerplExchange.allowOrderForwarding, (true)));
        vm.expectRevert(
            abi.encodeWithSelector(
                MandateAccount.CallNotAllowed.selector, address(perpl), IPerplExchange.allowOrderForwarding.selector
            )
        );
        exec(calls);
    }

    function test_refusesVenueWithdrawFromSessionKey() public {
        MandateAccount.Call[] memory calls = new MandateAccount.Call[](1);
        calls[0] = MandateAccount.Call(address(perpl), abi.encodeCall(IPerplExchange.withdrawCollateral, (1e6)));
        vm.expectPartialRevert(MandateAccount.CallNotAllowed.selector);
        exec(calls);
    }

    function test_refusesApproveToOtherSpender() public {
        MandateAccount.Call[] memory calls = new MandateAccount.Call[](1);
        calls[0] = MandateAccount.Call(address(ausd), abi.encodeCall(ausd.approve, (stranger, 1)));
        vm.expectPartialRevert(MandateAccount.CallNotAllowed.selector);
        exec(calls);
    }

    function test_refusesTokenTransfer() public {
        MandateAccount.Call[] memory calls = new MandateAccount.Call[](1);
        calls[0] = MandateAccount.Call(address(ausd), abi.encodeCall(ausd.transfer, (stranger, 1)));
        vm.expectPartialRevert(MandateAccount.CallNotAllowed.selector);
        exec(calls);
    }

    function test_refusesOtherTargets() public {
        MandateAccount.Call[] memory calls = new MandateAccount.Call[](1);
        calls[0] = MandateAccount.Call(stranger, "");
        vm.expectRevert(abi.encodeWithSelector(MandateAccount.TargetNotAllowed.selector, stranger));
        exec(calls);
    }

    function test_refusesRestingOpenOrders() public {
        IPerplExchange.OrderDesc memory d = order(BTC, 0, 10);
        d.immediateOrCancel = false;
        vm.expectPartialRevert(MandateAccount.CallNotAllowed.selector);
        exec(orderCall(d));
        d.fillOrKill = true;
        exec(orderCall(d)); // FOK is fine
    }

    function test_refusesChangeOrders() public {
        vm.expectPartialRevert(MandateAccount.CallNotAllowed.selector);
        exec(orderCall(order(BTC, 6, 10)));
    }

    // ------------------------------------------------------------ auth

    function test_strangerCannotExecute() public {
        vm.prank(stranger);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.execute(openLong(BTC, 10));
    }

    function test_ownerCanExecute() public {
        vm.prank(backer);
        account.execute(openLong(BTC, 10));
    }

    function test_expiredSessionKey() public {
        vm.roll(account.sessionKeyExpiresAtBlock() + 1);
        vm.prank(agent);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.execute(openLong(BTC, 10));
    }

    function test_operatorCanRevokeButNotSet() public {
        vm.prank(operatorAddr);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.setSessionKey(stranger, uint64(block.number + 10));

        vm.prank(operatorAddr);
        account.revokeSessionKey();
        assertFalse(account.isSessionKey(agent));
        vm.prank(agent);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.execute(openLong(BTC, 10));
    }

    /// Rotation: the old key stops working in the same block the new one is set (docs/rules-spec.md, section 6).
    function test_rotationRetiresTheOldKeyAtOnce() public {
        address next = makeAddr("next-agent");
        vm.prank(backer);
        account.setSessionKey(next, uint64(block.number + 100));

        vm.prank(agent);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.execute(openLong(BTC, 10));

        vm.prank(next);
        account.execute(openLong(BTC, 10));
    }

    function test_strangerCannotRevoke() public {
        vm.prank(stranger);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.revokeSessionKey();
    }

    function test_sessionKeyCannotWithdraw() public {
        vm.startPrank(agent);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.withdraw(1);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.withdrawFromVenue(1);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.setSessionKey(agent, uint64(block.number + 10));
        vm.stopPrank();
    }

    function test_badSessionKeyExpiry() public {
        vm.prank(backer);
        vm.expectRevert(MandateAccount.BadExpiry.selector);
        account.setSessionKey(agent, uint64(block.number));
    }

    function test_simulateOnlySelf() public {
        vm.prank(agent);
        vm.expectRevert(MandateAccount.Unauthorized.selector);
        account.simulate(openLong(BTC, 10));
    }

    // ------------------------------------------------------------ preflight

    function test_preflightEmitsViolationAndChangesNothing() public {
        uint256 lots = ethLots(12_000);
        MandateAccount.Call[] memory calls = openLong(ETH, lots);
        vm.expectEmit(true, false, false, false, address(account));
        emit MandateAccount.ViolationAttempted(address(account), 0, 0, 0, 0, bytes32(0));
        vm.prank(agent);
        bool ok = account.preflight(calls);
        assertFalse(ok);
        assertEq(adapter.accountState(address(account)).markets.length, 0, "no position opened");
        assertEq(account.monitor(3).w1, 0, "no monitor change");
    }

    function test_preflightPasses() public {
        vm.prank(agent);
        assertTrue(account.preflight(openLong(BTC, 10)));
        assertEq(adapter.accountState(address(account)).markets.length, 0);
    }

    function test_preflightBubblesOtherErrors() public {
        vm.prank(agent);
        vm.expectPartialRevert(MandateAccount.CallNotAllowed.selector);
        account.preflight(orderCall(order(BTC, 6, 10)));
    }

    // ------------------------------------------------------------ close-only and withdrawals

    function test_deactivatedAccountIsCloseOnly() public {
        exec(openLong(BTC, btcLots(1_000)));
        vm.prank(backer);
        registry.deactivate(mandateId);
        assertTrue(account.closeOnly());

        vm.expectRevert(MandateAccount.CloseOnlyMode.selector);
        exec(openLong(BTC, 10));
        exec(closeLong(BTC, btcLots(1_000)));
    }

    function test_withdrawBlockedWhilePositionsOpen() public {
        exec(openLong(BTC, 10));
        vm.prank(backer);
        vm.expectRevert(MandateAccount.PositionsOpen.selector);
        account.withdrawFromVenue(1e6);
    }

    function test_withdrawToOwnerLowersPeak() public {
        exec(orderCall(order(BTC, 4, 0))); // sets the drawdown peak at 1,000
        vm.startPrank(backer);
        account.withdrawFromVenue(400e6);
        account.withdraw(400e6);
        vm.stopPrank();
        assertEq(ausd.balanceOf(backer), 400e6);
        assertEq(account.monitor(5).w0, 600e6);
    }

    function test_withdrawAllowedWhenCloseOnly() public {
        exec(openLong(BTC, 10));
        vm.prank(backer);
        registry.deactivate(mandateId);
        vm.prank(backer);
        account.withdrawFromVenue(100e6);
        assertEq(ausd.balanceOf(address(account)), 100e6);
    }

    function test_noMandateNoExecute() public {
        vm.prank(backer);
        MandateAccount fresh = factory.createAccount(address(0), bytes32("fresh"));
        vm.prank(backer);
        vm.expectRevert(MandateAccount.NoMandate.selector);
        fresh.execute(openLong(BTC, 10));
        vm.expectRevert(MandateAccount.NoMandate.selector);
        fresh.poke();
    }
}
