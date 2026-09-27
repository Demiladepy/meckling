// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurvanceCollateralAdapter} from "../../src/collateral/CurvanceCollateralAdapter.sol";
import {ICurvanceCToken, ICurvanceBorrowableCToken, ICurvanceMarketManager} from "../../src/collateral/ICurvance.sol";

/// The collateral adapter against the real Curvance earnAUSD market on Monad mainnet (PRD 7.7, spike S2).
/// Curvance has no testnet deployment, so this is the only place the adapter moves real value in tests.
contract CurvanceCollateralAdapterForkTest is Test {
    // docs/spikes.md S2 — read from the Curvance SDK and confirmed on-chain.
    ICurvanceMarketManager constant MARKET = ICurvanceMarketManager(0xd6365555f6a697C7C295bA741100AA644cE28545);
    ICurvanceCToken constant C_EARN_AUSD = ICurvanceCToken(0x852FF1EC21D63b405eC431e04AE3AC760e29263D);
    ICurvanceBorrowableCToken constant C_AUSD = ICurvanceBorrowableCToken(0xAd4AA2a713fB86FBb6b60dE2aF9E32a11DB6Abf2);
    IERC20 constant EARN_AUSD = IERC20(0x103222f020e98Bba0AD9809A011FDF8e6F067496);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);

    /// Curvance blocks withdrawing collateral and repaying a loan for this long after the position changes
    /// (MIN_HOLD_PERIOD, seconds; MarketManager__MinimumHoldPeriod).
    uint256 constant HOLD = 1200;
    /// Curvance rejects loans below a minimum (LiquidityManager__InsufficientLoanSize): 1 AUSD fails, 100 AUSD works.
    uint256 constant PROBE = 100e6;

    CurvanceCollateralAdapter adapter;
    address backer = makeAddr("backer");
    address account = makeAddr("mandateAccount");
    uint256 unit; // one whole earnAUSD

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("monad"));
        adapter = new CurvanceCollateralAdapter(backer, C_EARN_AUSD, C_AUSD, 5_000);
        unit = 10 ** _decimals(address(EARN_AUSD));
        // earnAUSD may pack balances like AUSD, so fund from the collateral cToken, a large holder.
        vm.prank(address(C_EARN_AUSD));
        EARN_AUSD.transfer(backer, 1_000 * unit);
        vm.prank(backer);
        EARN_AUSD.approve(address(adapter), type(uint256).max);
    }

    function test_supply_postsCollateralInTheAdaptersName() public {
        vm.prank(backer);
        adapter.supply(1_000 * unit);
        assertGt(C_EARN_AUSD.collateralPosted(address(adapter)), 0, "collateral posted");
        (uint256 collateral, uint256 maxDebt, uint256 debt) = adapter.health();
        assertGt(collateral, 0);
        assertGt(maxDebt, 0);
        assertEq(debt, 0);
        assertEq(EARN_AUSD.balanceOf(backer), 0, "backer's earnAUSD moved in");
    }

    function test_borrowTo_sendsAusdToTheReceiver() public {
        vm.startPrank(backer);
        adapter.supply(1_000 * unit);
        adapter.borrowTo(100e6, account);
        vm.stopPrank();
        assertEq(AUSD.balanceOf(account), 100e6, "the mandate account received the loan");
        assertGe(C_AUSD.debtBalance(address(adapter)), 100e6, "debt sits with the adapter");
    }

    /// PRD 7.7: at most 50% of Curvance's own maximum. Borrowing up to just under the cap works; going past reverts.
    function test_borrowTo_capsAtHalfOfCurvancesMaximum() public {
        vm.startPrank(backer);
        adapter.supply(1_000 * unit);
        uint256 cap = _borrowCapInAusd(); // leaves PROBE borrowed
        adapter.borrowTo((cap * 99) / 100 - PROBE, account);
        vm.expectPartialRevert(CurvanceCollateralAdapter.ExceedsBorrowCap.selector);
        adapter.borrowTo(PROBE, account);
        vm.stopPrank();
    }

    function test_fund_suppliesAndBorrowsInOneCall() public {
        vm.prank(backer);
        adapter.fund(1_000 * unit, 200e6, account);
        assertEq(AUSD.balanceOf(account), 200e6);
        assertGt(C_EARN_AUSD.collateralPosted(address(adapter)), 0);
    }

    function test_repay_byAnyone_reducesDebt() public {
        vm.prank(backer);
        adapter.fund(1_000 * unit, 200e6, account);
        uint256 before = C_AUSD.debtBalance(address(adapter));
        _passHoldPeriod();
        vm.startPrank(account);
        AUSD.approve(address(adapter), 150e6);
        adapter.repay(150e6);
        vm.stopPrank();
        assertLt(C_AUSD.debtBalance(address(adapter)), before - 149e6, "debt fell by the repayment");
    }

    function test_withdrawCollateral_afterHoldPeriod_returnsIt() public {
        vm.prank(backer);
        adapter.supply(1_000 * unit);
        _passHoldPeriod();
        vm.prank(backer);
        adapter.withdrawCollateral(400 * unit, backer);
        assertEq(EARN_AUSD.balanceOf(backer), 400 * unit);
    }

    /// Pulling collateral out from under a loan must respect the same half-of-Curvance cap as borrowing.
    function test_withdrawCollateral_cannotBreachTheCap() public {
        vm.startPrank(backer);
        adapter.supply(1_000 * unit);
        adapter.borrowTo((_borrowCapInAusd() * 90) / 100 - PROBE, account);
        vm.stopPrank();
        _passHoldPeriod();
        // Curvance alone would allow this (debt stays under its own maximum); the adapter's half-cap must stop it.
        vm.expectPartialRevert(CurvanceCollateralAdapter.ExceedsBorrowCap.selector);
        vm.prank(backer);
        adapter.withdrawCollateral(500 * unit, backer);
    }

    // ------------------------------------------------------------ helpers

    /// Clears Curvance's hold period. A fork's clock moves but its oracles don't, so after the jump Curvance would
    /// reject every priced action as stale (MarketManager__PriceError). Fork-only shim: re-stamp the two leaf feeds
    /// under Curvance's oracle (found by tracing getPrice) with their *unchanged* answers at the new time.
    function _passHoldPeriod() internal {
        vm.warp(block.timestamp + HOLD + 1);
        // Each feed only answers its whitelisted reader, so read it as the aggregator the trace shows calling it.
        _restamp(0x253c95994246DE5A83AAFE82909681522DA051Af, 0xEd21588eA25ADC77384d47A466F0F75EEa58eBf3); // AUSD
        _restamp(0x433eBD107fC1B84F38D5BC6c28Fbb60E356B25Ef, 0x66608681545aaa50D9ebdBd9542fEeA4e49B85da); // earnAUSD part
    }

    function _restamp(address feed, address reader) internal {
        vm.prank(reader);
        (bool ok, bytes memory data) = feed.staticcall(abi.encodeWithSignature("latestRoundData()"));
        require(ok, "latestRoundData");
        (uint80 roundId, int256 answer,,, uint80 answeredInRound) =
            abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        vm.mockCall(
            feed,
            abi.encodeWithSignature("latestRoundData()"),
            abi.encode(roundId, answer, block.timestamp, block.timestamp, answeredInRound)
        );
    }

    /// statusOf reports value in Curvance's own units. Borrow PROBE AUSD to learn the ratio, then convert the cap.
    /// Leaves PROBE borrowed.
    function _borrowCapInAusd() internal returns (uint256) {
        adapter.borrowTo(PROBE, account);
        (, uint256 maxDebt, uint256 debt) = adapter.health();
        uint256 capUnits = (maxDebt * adapter.maxUseBps()) / 10_000;
        return (capUnits * PROBE) / debt;
    }

    function _decimals(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        require(ok, "decimals");
        return abi.decode(data, (uint8));
    }
}
