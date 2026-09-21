// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateTestBase} from "../utils/MandateTestBase.sol";
import {MockAUSD, MockPerplExchange} from "../mocks/MockPerplExchange.sol";
import {IPerplExchange} from "../../src/venues/IPerplExchange.sol";
import {PerplAdapter} from "../../src/venues/PerplAdapter.sol";
import {IVenue} from "../../src/venues/IVenue.sol";
import {MandateRegistry} from "../../src/MandateRegistry.sol";
import {MandateAccount} from "../../src/MandateAccount.sol";
import {Rule, RuleKind} from "../../src/rules/RuleTypes.sol";
import {RuleEngine} from "../../src/rules/RuleEngine.sol";
import {StateLib} from "../../src/rules/StateLib.sol";

/// Drives a MandateAccount with random agent trades, price moves, block advances, rule tightening, deactivation,
/// withdrawals and hostile calls. Invariant breaches are recorded in ghost flags (handler reverts are ignored by the
/// fuzzer, so asserting inside the handler would hide them).
contract MandateHandler is Test {
    MandateAccount immutable account;
    MandateRegistry immutable registry;
    PerplAdapter immutable adapter;
    MockPerplExchange immutable perpl;
    MockAUSD immutable ausd;
    address immutable backer;
    address immutable agent;
    address immutable stranger;
    uint256 immutable mandateId;

    uint256[3] internal perps = [uint256(1), 10, 20];
    uint256[3] internal baseMarks = [uint256(850_000), 25_500, 273_000];

    // ghosts
    bool public inv1Broken; // an execute succeeded that grew exposure past an action rule
    bool public inv3Broken; // a session-key action moved funds somewhere other than the venue
    bool public inv7Broken; // exposure grew after deactivation
    bool public inv8Broken; // the drawdown peak fell without a withdrawal
    uint256 public ghostBackerBalance;
    uint256 public executes;
    uint256 public violations;
    uint256 public lastPeak;

    constructor(
        MandateAccount account_,
        MandateRegistry registry_,
        PerplAdapter adapter_,
        MockPerplExchange perpl_,
        MockAUSD ausd_,
        address backer_,
        address agent_,
        address stranger_,
        uint256 mandateId_
    ) {
        account = account_;
        registry = registry_;
        adapter = adapter_;
        perpl = perpl_;
        ausd = ausd_;
        backer = backer_;
        agent = agent_;
        stranger = stranger_;
        mandateId = mandateId_;
        lastPeak = account_.monitor(5).w0;
    }

    modifier checkPeak(bool isWithdrawal) {
        _;
        uint256 peak = account.monitor(5).w0;
        if (!isWithdrawal && peak < lastPeak) inv8Broken = true;
        lastPeak = peak;
    }

    function _orderCalls(uint256 perpId, uint8 t, uint256 lot) internal view returns (MandateAccount.Call[] memory c) {
        IPerplExchange.OrderDesc[] memory d = new IPerplExchange.OrderDesc[](1);
        d[0].perpId = perpId;
        d[0].orderType = t;
        d[0].lotLNS = lot;
        d[0].immediateOrCancel = true;
        d[0].leverageHdths = 2_000;
        c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(perpl), abi.encodeCall(IPerplExchange.execOrders, (d, true)));
    }

    // ------------------------------------------------------------ agent actions

    function agentTrade(uint256 marketSeed, uint256 typeSeed, uint256 lotSeed) external checkPeak(false) {
        uint256 perpId = perps[marketSeed % 3];
        uint8 t = uint8(typeSeed % 4);
        uint256 lot = perpId == 1
            ? bound(lotSeed, 1, 10_000)
            : perpId == 10 ? bound(lotSeed, 1, 200_000) : bound(lotSeed, 1, 3_000);

        IVenue.AccountState memory pre = adapter.accountState(address(account));
        uint256 backerBefore = ausd.balanceOf(backer);
        uint256 venueBefore = ausd.balanceOf(address(perpl));
        uint256 idleBefore = ausd.balanceOf(address(account));
        (, Rule[] memory rules) = registry.getMandate(mandateId);
        bool closeOnly = account.closeOnly();

        vm.prank(agent);
        try account.execute(_orderCalls(perpId, t, lot)) {
            ++executes;
            IVenue.AccountState memory post = adapter.accountState(address(account));
            if (!closeOnly) _checkRules(rules, pre, post);
            if (closeOnly && post.totalNotional > pre.totalNotional) inv7Broken = true;
            // Invariant 3: the agent's trade moves no tokens except between the account and the venue.
            if (ausd.balanceOf(backer) != backerBefore) inv3Broken = true;
            if (ausd.balanceOf(address(perpl)) + ausd.balanceOf(address(account)) != venueBefore + idleBefore) {
                inv3Broken = true;
            }
        } catch (bytes memory reason) {
            if (bytes4(reason) == MandateAccount.MandateViolation.selector) ++violations;
        }
    }

    /// Invariant 1, as refined in docs/decisions.md: after a successful execute each price-independent action rule
    /// holds, or the execute did not grow the exposure that rule limits.
    function _checkRules(Rule[] memory rules, IVenue.AccountState memory pre, IVenue.AccountState memory post)
        internal
    {
        for (uint256 i; i < rules.length; ++i) {
            Rule memory r = rules[i];
            if (r.kind == RuleKind.MaxLeverage) {
                uint256 eq = post.equity > 0 ? uint256(post.equity) : 0;
                if (post.totalNotional * 10_000 > r.p1 * eq && post.totalNotional > pre.totalNotional) {
                    inv1Broken = true;
                }
            } else if (r.kind == RuleKind.MaxNotionalPerMarket) {
                uint256 n = StateLib.market(post, r.p1).notional;
                if (n > r.p2 && n > StateLib.market(pre, r.p1).notional) inv1Broken = true;
            } else if (r.kind == RuleKind.AllowedMarkets) {
                for (uint256 j; j < post.markets.length; ++j) {
                    uint256 id = post.markets[j].marketId;
                    bool ok = id < 256 && (r.p1 >> id) & 1 == 1;
                    if (!ok && post.markets[j].notional > StateLib.market(pre, id).notional) inv1Broken = true;
                }
            } else if (r.kind == RuleKind.OrderRateLimit) {
                if (account.monitor(i).w1 > r.p1) inv1Broken = true;
            }
        }
    }

    function agentPreflight(uint256 marketSeed, uint256 lotSeed) external checkPeak(false) {
        uint256 perpId = perps[marketSeed % 3];
        vm.prank(agent);
        try account.preflight(_orderCalls(perpId, 0, bound(lotSeed, 1, 20_000))) {} catch {}
    }

    /// Hostile calls from the session key must never move funds.
    function agentHostile(uint256 seed) external checkPeak(false) {
        MandateAccount.Call[] memory c = new MandateAccount.Call[](1);
        uint256 k = seed % 5;
        if (k == 0) {
            c[0] = MandateAccount.Call(address(ausd), abi.encodeCall(ausd.transfer, (agent, 1)));
        } else if (k == 1) {
            c[0] = MandateAccount.Call(address(ausd), abi.encodeCall(ausd.approve, (agent, 1e30)));
        } else if (k == 2) {
            c[0] = MandateAccount.Call(address(perpl), abi.encodeCall(IPerplExchange.withdrawCollateral, (1)));
        } else if (k == 3) {
            c[0] = MandateAccount.Call(address(perpl), abi.encodeCall(IPerplExchange.allowOrderForwarding, (true)));
        } else {
            c[0] = MandateAccount.Call(agent, "");
        }
        vm.startPrank(agent);
        try account.execute(c) {
            inv3Broken = true;
        } catch {}
        try account.withdraw(1) {
            inv3Broken = true;
        } catch {}
        try account.withdrawFromVenue(1) {
            inv3Broken = true;
        } catch {}
        vm.stopPrank();
        if (perpl.forwardingAllowed(address(account))) inv3Broken = true;
    }

    // ------------------------------------------------------------ market and time

    function moveMark(uint256 marketSeed, uint256 bpsSeed) external checkPeak(false) {
        uint256 i = marketSeed % 3;
        uint256 bps = bound(bpsSeed, 7_000, 13_000); // within +-30% of the base mark
        perpl.setMark(perps[i], baseMarks[i] * bps / 10_000);
    }

    function advance(uint256 blocks) external checkPeak(false) {
        vm.roll(block.number + bound(blocks, 1, 300));
    }

    function poke() external checkPeak(false) {
        vm.prank(stranger);
        account.poke();
    }

    // ------------------------------------------------------------ backer

    function tighten(uint256 idxSeed, uint256 p1Seed, uint256 p2Seed) external checkPeak(false) {
        (, Rule[] memory rules) = registry.getMandate(mandateId);
        uint256 i = idxSeed % rules.length;
        Rule memory r = rules[i];
        // Random candidate around the current values; the registry must reject anything looser.
        r.p1 = r.kind == RuleKind.MaxNotionalPerMarket ? r.p1 : bound(p1Seed, 0, r.p1 * 2 + 1);
        r.p2 = r.kind == RuleKind.MaxLeverage || r.kind == RuleKind.AllowedMarkets || r.kind == RuleKind.MaxDrawdown
            ? 0
            : bound(p2Seed, 0, r.p2 * 2 + 1);
        vm.prank(backer);
        try registry.tightenRule(mandateId, i, r) {} catch {}
    }

    function deactivate(uint256 seed) external checkPeak(false) {
        if (seed % 20 != 0) return; // rare
        vm.prank(backer);
        try registry.deactivate(mandateId) {} catch {}
    }

    function backerWithdraw(uint256 amountSeed) external checkPeak(true) {
        uint256 amount = bound(amountSeed, 0, 2_000e6);
        vm.startPrank(backer);
        try account.withdrawFromVenue(amount) {} catch {}
        uint256 idle = ausd.balanceOf(address(account));
        uint256 w = amount > idle ? idle : amount;
        try account.withdraw(w) {
            ghostBackerBalance += w;
        } catch {}
        vm.stopPrank();
    }
}

contract MandateInvariantTest is MandateTestBase {
    MandateHandler handler;
    Rule[] initialRules;
    uint256 totalMinted = 1_000e6;

    function setUp() public override {
        super.setUp();
        setUpTrading(defaultRules());
        (, Rule[] memory r) = registry.getMandate(mandateId);
        for (uint256 i; i < r.length; ++i) {
            initialRules.push(r[i]);
        }
        handler = new MandateHandler(account, registry, adapter, perpl, ausd, backer, agent, stranger, mandateId);
        targetContract(address(handler));
    }

    /// 1. After any successful execute, every action rule holds (or the execute did not grow that exposure).
    function invariant_1_actionRulesHoldAfterExecute() public view {
        assertFalse(handler.inv1Broken());
    }

    /// 2. Tokens only ever sit with the account, the venue, or the owner/backer. Nobody else receives any.
    function invariant_2_tokensOnlyToAllowedAddresses() public view {
        assertEq(ausd.balanceOf(agent), 0);
        assertEq(ausd.balanceOf(operatorAddr), 0);
        assertEq(ausd.balanceOf(stranger), 0);
        assertEq(ausd.balanceOf(address(handler)), 0);
        assertEq(
            ausd.balanceOf(address(account)) + ausd.balanceOf(address(perpl)) + ausd.balanceOf(backer), totalMinted
        );
    }

    /// 3. A session key can never cause funds to leave except into the venue; only owner withdrawals pay the backer.
    function invariant_3_sessionKeyCannotMoveFundsOut() public view {
        assertFalse(handler.inv3Broken());
        assertEq(ausd.balanceOf(backer), handler.ghostBackerBalance());
    }

    /// 4. Rules can only be tightened, never loosened.
    function invariant_4_rulesOnlyTighten() public view {
        (, Rule[] memory current) = registry.getMandate(mandateId);
        assertEq(current.length, initialRules.length);
        for (uint256 i; i < current.length; ++i) {
            Rule memory a = initialRules[i];
            Rule memory b = current[i];
            bool same = a.kind == b.kind && a.p1 == b.p1 && a.p2 == b.p2 && a.p3 == b.p3;
            assertTrue(same || RuleEngine.isTightening(a, b), "rule loosened");
        }
    }

    /// 7. After deactivation (M1's close-only trigger; BondVault breaches add another in M2) exposure never grows.
    function invariant_7_closeOnlyNeverGrowsExposure() public view {
        assertFalse(handler.inv7Broken());
    }

    /// 8. The equity peak is non-decreasing, except when the owner withdraws.
    function invariant_8_peakNonDecreasing() public view {
        assertFalse(handler.inv8Broken());
    }

    /// Sanity check that the handler reaches both outcomes the invariants are about.
    function test_handlerExercisesTradesAndViolations() public {
        handler.agentTrade(0, 0, 500); // small BTC long: passes
        handler.agentTrade(2, 0, 3_000); // ~$8,190 ETH long on ~$1,000 equity: MaxLeverage violation
        handler.agentTrade(1, 0, 1_000); // MON is not an allowed market
        assertEq(handler.executes(), 1);
        assertEq(handler.violations(), 2);
    }
}
