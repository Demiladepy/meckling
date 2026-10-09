// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console2} from "forge-std/console2.sol";
import {MandateTestBase} from "./utils/MandateTestBase.sol";
import {RuleEngine} from "../src/rules/RuleEngine.sol";
import {Monitor} from "../src/rules/RuleTypes.sol";

/// Monad's MIP-8 prices storage by 128-slot page: the first read on a page costs 8,100 gas, later reads on that page
/// 100 (docs/spikes.md). Foundry meters gas the Ethereum way, so it can't show a paging win; this test records which
/// storage slots one enforced trade actually touches in Mandate's own contracts and counts the distinct pages, the
/// quantity MIP-8 charges for. It also fails if a change makes execute touch more pages than today.
contract StoragePagesTest is MandateTestBase {
    uint256 constant PAGE_SHIFT = 7; // 128 slots per page

    function _pages(bytes32[] memory reads, bytes32[] memory writes)
        internal
        pure
        returns (uint256 pages, uint256 slots)
    {
        bytes32[] memory seen = new bytes32[](reads.length + writes.length);
        uint256[] memory pageList = new uint256[](reads.length + writes.length);
        for (uint256 i; i < reads.length + writes.length; ++i) {
            bytes32 s = i < reads.length ? reads[i] : writes[i - reads.length];
            bool dup;
            for (uint256 j; j < slots; ++j) {
                if (seen[j] == s) dup = true;
            }
            if (dup) continue;
            seen[slots++] = s;
            uint256 page = uint256(s) >> PAGE_SHIFT;
            bool known;
            for (uint256 j; j < pages; ++j) {
                if (pageList[j] == page) known = true;
            }
            if (!known) pageList[pages++] = page;
        }
    }

    /// One enforced trade with the six-rule demo mandate: how many distinct pages of our own storage it touches.
    function test_pagesTouchedByAnEnforcedTrade() public {
        setUpTrading(defaultRules());
        vm.roll(block.number + 1);

        vm.record();
        uint256 g0 = gasleft();
        exec(openLong(BTC, btcLots(500)));
        console2.log("execute gas, Ethereum metering (Foundry):", g0 - gasleft());

        address[3] memory who = [address(account), address(registry), address(adapter)];
        string[3] memory names = ["MandateAccount", "MandateRegistry", "PerplAdapter"];
        uint256 totalPages;
        for (uint256 k; k < who.length; ++k) {
            (bytes32[] memory reads, bytes32[] memory writes) = vm.accesses(who[k]);
            (uint256 pages, uint256 slots) = _pages(reads, writes);
            totalPages += pages;
            console2.log(names[k], "distinct slots:", slots);
            console2.log(names[k], "distinct pages:", pages);
        }
        console2.log("total pages of Mandate storage touched:", totalPages);
        console2.log("MIP-8 cold-page cost of those pages (8,100 each):", totalPages * 8_100);
        assertLe(totalPages, PAGE_BUDGET, "execute touches more storage pages than the recorded budget");
    }

    /// MandateAccount's Monitor[16] and MandateRegistry's Rule[16] are sized with a literal (Solidity won't take a
    /// library constant there). This pins them to the rule limit, and checks an out-of-range monitor reads as empty.
    function test_fixedArraysMatchTheRuleLimit() public view {
        assertEq(RuleEngine.MAX_RULES, 16);
        Monitor memory m = account.monitor(RuleEngine.MAX_RULES);
        assertEq(m.w0, 0);
        assertEq(m.w1, 0);
    }

    /// The recorded budget: 9 before the MIP-8 layout (monitors in a mapping, the mandate across three mappings), 3
    /// after. Lower it when an optimisation lands; never raise it without a reason in the commit.
    uint256 constant PAGE_BUDGET = 3;
}
