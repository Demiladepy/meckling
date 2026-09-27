// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CurvanceCollateralAdapter} from "../src/collateral/CurvanceCollateralAdapter.sol";
import {ICurvanceCToken, ICurvanceBorrowableCToken} from "../src/collateral/ICurvance.sol";

/// Constructor and access rules, which need no live market. Everything that moves value is covered by the fork suite
/// (test/fork/CurvanceCollateralAdapter.fork.t.sol) against the real Curvance market, since Curvance has no testnet.
contract MockMarket {
    mapping(address => bool) public isListed;

    function list(address cToken, bool yes) external {
        isListed[cToken] = yes;
    }
}

contract MockCToken {
    address public marketManager;
    address public asset;

    constructor(address mm, address asset_) {
        marketManager = mm;
        asset = asset_;
    }
}

contract CurvanceCollateralAdapterTest is Test {
    MockMarket market;
    MockMarket otherMarket;
    MockCToken coll;
    MockCToken debt;
    address backer = makeAddr("backer");

    function setUp() public {
        market = new MockMarket();
        otherMarket = new MockMarket();
        coll = new MockCToken(address(market), makeAddr("earnAUSD"));
        debt = new MockCToken(address(market), makeAddr("AUSD"));
        market.list(address(coll), true);
        market.list(address(debt), true);
    }

    function _deploy(uint256 bps) internal returns (CurvanceCollateralAdapter) {
        return new CurvanceCollateralAdapter(
            backer, ICurvanceCToken(address(coll)), ICurvanceBorrowableCToken(address(debt)), bps
        );
    }

    function test_constructor_setsEverything() public {
        CurvanceCollateralAdapter a = _deploy(5_000);
        assertEq(a.owner(), backer);
        assertEq(address(a.market()), address(market));
        assertEq(address(a.collateralAsset()), coll.asset());
        assertEq(address(a.debtAsset()), debt.asset());
        assertEq(a.maxUseBps(), 5_000);
    }

    /// PRD 7.7: never borrow more than half of what Curvance itself would allow.
    function test_constructor_rejectsUseAboveHalfOfCurvance() public {
        vm.expectRevert(abi.encodeWithSelector(CurvanceCollateralAdapter.BadUseBps.selector, 5_001));
        _deploy(5_001);
    }

    function test_constructor_rejectsZeroUse() public {
        vm.expectRevert(abi.encodeWithSelector(CurvanceCollateralAdapter.BadUseBps.selector, 0));
        _deploy(0);
    }

    function test_constructor_rejectsTokensFromDifferentMarkets() public {
        MockCToken foreign = new MockCToken(address(otherMarket), makeAddr("AUSD2"));
        otherMarket.list(address(foreign), true);
        vm.expectRevert(CurvanceCollateralAdapter.NotSameListedMarket.selector);
        new CurvanceCollateralAdapter(
            backer, ICurvanceCToken(address(coll)), ICurvanceBorrowableCToken(address(foreign)), 5_000
        );
    }

    function test_constructor_rejectsUnlistedToken() public {
        market.list(address(debt), false);
        vm.expectRevert(CurvanceCollateralAdapter.NotSameListedMarket.selector);
        _deploy(5_000);
    }

    function test_ownerOnly_supplyBorrowFundWithdraw() public {
        CurvanceCollateralAdapter a = _deploy(5_000);
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(CurvanceCollateralAdapter.Unauthorized.selector);
        a.supply(1);
        vm.expectRevert(CurvanceCollateralAdapter.Unauthorized.selector);
        a.borrowTo(1, stranger);
        vm.expectRevert(CurvanceCollateralAdapter.Unauthorized.selector);
        a.fund(1, 1, stranger);
        vm.expectRevert(CurvanceCollateralAdapter.Unauthorized.selector);
        a.withdrawCollateral(1, stranger);
        vm.stopPrank();
    }

    function test_zeroAmountsRevert() public {
        CurvanceCollateralAdapter a = _deploy(5_000);
        vm.startPrank(backer);
        vm.expectRevert(CurvanceCollateralAdapter.ZeroAmount.selector);
        a.supply(0);
        vm.expectRevert(CurvanceCollateralAdapter.ZeroAmount.selector);
        a.borrowTo(0, backer);
        vm.expectRevert(CurvanceCollateralAdapter.ZeroAmount.selector);
        a.withdrawCollateral(0, backer);
        vm.stopPrank();
        vm.expectRevert(CurvanceCollateralAdapter.ZeroAmount.selector);
        a.repay(0);
    }
}
