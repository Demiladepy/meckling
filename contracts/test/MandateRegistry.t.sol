// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateTestBase} from "./utils/MandateTestBase.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {MandateAccount} from "../src/MandateAccount.sol";
import {Rule, RuleKind} from "../src/rules/RuleTypes.sol";

contract MandateRegistryTest is MandateTestBase {
    function test_createMandateStoresEverything() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit MandateRegistry.MandateCreated(1, address(account), backer, keccak256("nansen-report"));
        createMandate(defaultRules());

        (MandateRegistry.Mandate memory m, Rule[] memory rules) = registry.getMandate(mandateId);
        assertEq(m.account, address(account));
        assertEq(m.backer, backer);
        assertEq(m.operator, operatorAddr);
        assertEq(m.reportHash, keccak256("nansen-report"));
        assertEq(m.createdAtBlock, block.number);
        assertEq(m.disputeWindowBlocks, 600);
        assertTrue(m.active);
        assertEq(rules.length, 6);
        assertEq(registry.mandateIdOf(address(account)), mandateId);

        (bool exists, bool active, Rule[] memory r2) = registry.rulesOf(address(account));
        assertTrue(exists && active);
        assertEq(uint8(r2[4].kind), uint8(RuleKind.LossCooldown));
    }

    function test_onlyAccountOwnerCreates() public {
        vm.prank(stranger);
        vm.expectRevert(MandateRegistry.NotAccountOwner.selector);
        registry.createMandate(address(account), defaultRules(), 0, 0);
    }

    function test_rejectsNonFactoryAccounts() public {
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NotFactoryAccount.selector, stranger));
        registry.createMandate(stranger, defaultRules(), 0, 0);
    }

    function test_oneMandatePerAccount() public {
        createMandate(defaultRules());
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.MandateExists.selector, address(account)));
        registry.createMandate(address(account), defaultRules(), 0, 0);
    }

    function test_ruleCountBounds() public {
        vm.startPrank(backer);
        vm.expectRevert(MandateRegistry.BadRuleCount.selector);
        registry.createMandate(address(account), new Rule[](0), 0, 0);
        vm.expectRevert(MandateRegistry.BadRuleCount.selector);
        registry.createMandate(address(account), new Rule[](17), 0, 0);
        vm.stopPrank();
    }

    function test_rejectsInvalidRules() public {
        Rule[] memory r = new Rule[](1);
        Rule[6] memory bad = [
            rule(RuleKind.MaxLeverage, 0, 0),
            rule(RuleKind.MaxNotionalPerMarket, BTC, 0),
            rule(RuleKind.AllowedMarkets, 0, 0),
            rule(RuleKind.OrderRateLimit, 5, 0),
            rule(RuleKind.LossCooldown, 0, 10),
            rule(RuleKind.MaxDrawdown, 10_000, 0)
        ];
        for (uint256 i; i < bad.length; ++i) {
            r[0] = bad[i];
            vm.prank(backer);
            vm.expectRevert(abi.encodeWithSelector(MandateRegistry.InvalidRule.selector, 0));
            registry.createMandate(address(account), r, 0, 0);
        }
        r[0] = Rule(RuleKind.MaxLeverage, 30_000, 0, 1); // unused params must be zero
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.InvalidRule.selector, 0));
        registry.createMandate(address(account), r, 0, 0);
    }

    function test_pauseBlocksNewMandatesOnly() public {
        vm.prank(admin);
        registry.setPaused(true);
        vm.prank(backer);
        vm.expectRevert(MandateRegistry.NewMandatesPaused.selector);
        registry.createMandate(address(account), defaultRules(), 0, 0);

        vm.prank(stranger);
        vm.expectRevert();
        registry.setPaused(false);
    }

    /// The base already set both (factory in setUp, bond vault with the M2 contracts), so both must now refuse.
    function test_factoryAndVaultSetOnce() public {
        assertEq(address(registry.factory()), address(factory));
        assertEq(registry.bondVault(), address(vault));
        vm.startPrank(admin);
        vm.expectRevert(MandateRegistry.AlreadySet.selector);
        registry.setFactory(stranger);
        vm.expectRevert(MandateRegistry.AlreadySet.selector);
        registry.setBondVault(stranger);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ tightening

    function test_tightenEachKind() public {
        createMandate(defaultRules());
        Rule[6] memory tighter = [
            rule(RuleKind.MaxLeverage, 20_000, 0),
            rule(RuleKind.MaxNotionalPerMarket, BTC, 1_000e6),
            rule(RuleKind.AllowedMarkets, 1 << BTC, 0),
            rule(RuleKind.OrderRateLimit, 3, 40),
            rule(RuleKind.LossCooldown, 5e6, 600),
            rule(RuleKind.MaxDrawdown, 300, 0)
        ];
        for (uint256 i; i < 6; ++i) {
            vm.prank(backer);
            registry.tightenRule(mandateId, i, tighter[i]);
        }
        (, Rule[] memory rules) = registry.getMandate(mandateId);
        assertEq(rules[0].p1, 20_000);
        assertEq(rules[4].p2, 600);
    }

    function test_cannotLoosenAnyKind() public {
        createMandate(defaultRules());
        Rule[8] memory looser = [
            rule(RuleKind.MaxLeverage, 50_000, 0),
            rule(RuleKind.MaxNotionalPerMarket, BTC, 3_000e6),
            rule(RuleKind.AllowedMarkets, (1 << BTC) | (1 << MON), 0),
            rule(RuleKind.OrderRateLimit, 6, 20),
            rule(RuleKind.LossCooldown, 10e6, 100),
            rule(RuleKind.MaxDrawdown, 800, 0),
            rule(RuleKind.MaxNotionalPerMarket, ETH, 100e6), // different market is not a tightening
            rule(RuleKind.MaxDrawdown, 300, 0) // wrong kind for index 0 below
        ];
        uint256[8] memory idx = [uint256(0), 1, 2, 3, 4, 5, 1, 0];
        for (uint256 i; i < looser.length; ++i) {
            vm.prank(backer);
            vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NotTightening.selector, idx[i]));
            registry.tightenRule(mandateId, idx[i], looser[i]);
        }
        vm.prank(backer);
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.NotTightening.selector, 9));
        registry.tightenRule(mandateId, 9, looser[0]);
    }

    function test_onlyBackerTightensAndDeactivates() public {
        createMandate(defaultRules());
        vm.startPrank(operatorAddr);
        vm.expectRevert(MandateRegistry.NotBacker.selector);
        registry.tightenRule(mandateId, 0, rule(RuleKind.MaxLeverage, 10_000, 0));
        vm.expectRevert(MandateRegistry.NotBacker.selector);
        registry.deactivate(mandateId);
        vm.stopPrank();
    }

    function test_deactivateIsFinal() public {
        createMandate(defaultRules());
        vm.startPrank(backer);
        registry.deactivate(mandateId);
        vm.expectRevert(MandateRegistry.Inactive.selector);
        registry.deactivate(mandateId);
        vm.expectRevert(MandateRegistry.Inactive.selector);
        registry.tightenRule(mandateId, 0, rule(RuleKind.MaxLeverage, 10_000, 0));
        vm.stopPrank();
        (, bool active,) = registry.rulesOf(address(account));
        assertFalse(active);
    }

    function test_unknownMandate() public {
        vm.expectRevert(abi.encodeWithSelector(MandateRegistry.UnknownMandate.selector, 42));
        registry.getMandate(42);
    }

    // ------------------------------------------------------------ factory

    function test_factoryPredictsAddress() public {
        address predicted = factory.predictAddress(stranger, address(0), bytes32("x"));
        vm.prank(stranger);
        MandateAccount a = factory.createAccount(address(0), bytes32("x"));
        assertEq(address(a), predicted);
        assertTrue(factory.isAccount(predicted));
        assertEq(a.owner(), stranger);
        assertEq(a.operator(), address(0));
    }
}
