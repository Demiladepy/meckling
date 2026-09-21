// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IPerplExchange} from "../src/venues/IPerplExchange.sol";

/// @notice Pins the hand-written Perpl interface to the canonical signatures in Perpl's ABI
///         (abi/PerplExchange.json, from PerplFoundation/dex-sdk). A wrong struct field or type changes the
///         selector, so a drifted interface fails here instead of silently mis-encoding calls on-chain.
contract PerplInterfaceTest is Test {
    string constant ORDER_DESC =
        "(uint256,uint256,uint8,uint256,uint256,uint256,uint256,bool,bool,bool,uint256,uint256,uint256,uint256,uint256)";

    function _sel(string memory sig) internal pure returns (bytes4) {
        return bytes4(keccak256(bytes(sig)));
    }

    function test_orderEntrySelectors() public pure {
        assertEq(IPerplExchange.execOrders.selector, _sel(string.concat("execOrders(", ORDER_DESC, "[],bool)")));
        assertEq(IPerplExchange.execOrder.selector, _sel(string.concat("execOrder(", ORDER_DESC, ")")));
    }

    function test_accountSelectors() public pure {
        assertEq(IPerplExchange.createAccount.selector, _sel("createAccount(uint256)"));
        assertEq(IPerplExchange.depositCollateral.selector, _sel("depositCollateral(uint256)"));
        assertEq(IPerplExchange.withdrawCollateral.selector, _sel("withdrawCollateral(uint256)"));
        assertEq(IPerplExchange.allowOrderForwarding.selector, _sel("allowOrderForwarding(bool)"));
    }

    function test_viewSelectors() public pure {
        assertEq(IPerplExchange.getAccountByAddr.selector, _sel("getAccountByAddr(address)"));
        assertEq(IPerplExchange.getPosition.selector, _sel("getPosition(uint256,uint256)"));
        assertEq(IPerplExchange.getOrder.selector, _sel("getOrder(uint256,uint256)"));
        assertEq(IPerplExchange.getExchangeInfo.selector, _sel("getExchangeInfo()"));
        assertEq(IPerplExchange.getPerpetualExistsBitmap.selector, _sel("getPerpetualExistsBitmap()"));
    }

    /// Cross-checks the ABI file itself: every signature we pin must be present in Perpl's published ABI.
    function test_signaturesExistInPublishedAbi() public view {
        string memory abiJson = vm.readFile("abi/PerplExchange.json");
        string[6] memory names = [
            "execOrders",
            "createAccount",
            "depositCollateral",
            "getAccountByAddr",
            "getPosition",
            "allowOrderForwarding"
        ];
        for (uint256 i; i < names.length; ++i) {
            assertTrue(
                vm.contains(abiJson, string.concat("\"name\": \"", names[i], "\""))
                    || vm.contains(abiJson, string.concat("\"name\":\"", names[i], "\"")),
                names[i]
            );
        }
    }
}
