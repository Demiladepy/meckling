// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateTestBase} from "./utils/MandateTestBase.sol";
import {CreKeeperReceiver, IReceiver} from "../src/CreKeeperReceiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

contract CreKeeperReceiverTest is MandateTestBase {
    // Literals, not receiver.ACTION_*(): a getter call would consume the vm.prank meant for onReport.
    uint8 constant FLAG = 0;
    uint8 constant SLASH = 1;

    CreKeeperReceiver receiver;
    address forwarder = makeAddr("keystoneForwarder");

    function setUp() public override {
        super.setUp();
        setUpTrading(defaultRules());
        postBond(200);
        receiver = new CreKeeperReceiver(forwarder, vault);
    }

    function _breachState() internal {
        exec(openLong(BTC, btcLots(1_000)));
        setMarkAndFeed(BTC, BTC_MARK * 94 / 100); // 6% drawdown against the 5% limit
    }

    function test_onlyForwarderMayReport() public {
        bytes memory report = abi.encode(FLAG, address(account), uint256(5));
        vm.prank(stranger);
        vm.expectRevert(CreKeeperReceiver.NotForwarder.selector);
        receiver.onReport("", report);
    }

    function test_forwardedReportFlagsTheBreach() public {
        _breachState();
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(FLAG, address(account), uint256(5)));
        assertEq(vault.breachCount(), 1);
        assertTrue(account.breached());
    }

    /// A report that does not match on-chain state cannot invent a breach; the receiver just records the failure.
    function test_falseReportCannotInventABreach() public {
        vm.expectEmit(true, false, false, true, address(receiver));
        emit CreKeeperReceiver.ReportHandled(0, address(account), 5, false);
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(FLAG, address(account), uint256(5)));
        assertEq(vault.breachCount(), 0);
        assertFalse(account.breached());
    }

    function test_forwardedReportSlashesAfterTheWindow() public {
        _breachState();
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(FLAG, address(account), uint256(5)));

        vm.roll(block.number + 601);
        uint256 before = ausd.balanceOf(backer);
        vm.prank(forwarder);
        receiver.onReport("", abi.encode(SLASH, address(account), uint256(0)));
        assertGt(ausd.balanceOf(backer), before);
    }

    function test_unknownActionReverts() public {
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(CreKeeperReceiver.UnknownAction.selector, 7));
        receiver.onReport("", abi.encode(uint8(7), address(account), uint256(0)));
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
        assertFalse(receiver.supportsInterface(bytes4(0xdeadbeef)));
    }
}
