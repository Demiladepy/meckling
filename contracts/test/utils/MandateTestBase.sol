// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockAUSD, MockPerplExchange} from "../mocks/MockPerplExchange.sol";
import {IPerplExchange} from "../../src/venues/IPerplExchange.sol";
import {PerplAdapter} from "../../src/venues/PerplAdapter.sol";
import {IVenue} from "../../src/venues/IVenue.sol";
import {MandateRegistry} from "../../src/MandateRegistry.sol";
import {MandateAccount, IMandateRules} from "../../src/MandateAccount.sol";
import {MandateAccountFactory} from "../../src/MandateAccountFactory.sol";
import {Rule, RuleKind} from "../../src/rules/RuleTypes.sol";

abstract contract MandateTestBase is Test {
    // Market ids and decimals mirror Perpl mainnet (docs/spikes.md S1).
    uint256 constant BTC = 1; // price decimals 1, lot decimals 5
    uint256 constant MON = 10; // price decimals 6, lot decimals 0
    uint256 constant ETH = 20; // price decimals 2, lot decimals 3
    uint256 constant BTC_MARK = 850_000; // $85,000.0
    uint256 constant ETH_MARK = 273_000; // $2,730.00

    address admin = makeAddr("admin");
    address backer = makeAddr("backer");
    address operatorAddr = makeAddr("operator");
    address agent = makeAddr("agent");
    address stranger = makeAddr("stranger");

    MockAUSD ausd;
    MockPerplExchange perpl;
    PerplAdapter adapter;
    MandateRegistry registry;
    MandateAccountFactory factory;
    MandateAccount account;
    uint256 mandateId;

    function setUp() public virtual {
        vm.roll(1_000);
        ausd = new MockAUSD();
        perpl = new MockPerplExchange(ausd);
        perpl.addMarket(BTC, 1, 5, BTC_MARK);
        perpl.addMarket(MON, 6, 0, 25_500);
        perpl.addMarket(ETH, 2, 3, ETH_MARK);
        adapter = new PerplAdapter(IPerplExchange(address(perpl)));
        registry = new MandateRegistry(admin);
        factory = new MandateAccountFactory(IMandateRules(address(registry)), IVenue(address(adapter)));
        vm.prank(admin);
        registry.setFactory(address(factory));

        vm.prank(backer);
        account = factory.createAccount(operatorAddr, bytes32("demo"));
        ausd.mint(address(account), 1_000e6);
    }

    // ------------------------------------------------------------ rules

    function rule(RuleKind kind, uint256 p1, uint256 p2) internal pure returns (Rule memory) {
        return Rule(kind, p1, p2, 0);
    }

    /// The demo mandate: 3x leverage, $2,000 BTC notional, BTC+ETH only, 5 orders / 20 blocks, 150-block cooldown
    /// after a $10 loss, 5% max drawdown.
    function defaultRules() internal pure returns (Rule[] memory r) {
        r = new Rule[](6);
        r[0] = rule(RuleKind.MaxLeverage, 30_000, 0);
        r[1] = rule(RuleKind.MaxNotionalPerMarket, BTC, 2_000e6);
        r[2] = rule(RuleKind.AllowedMarkets, (1 << BTC) | (1 << ETH), 0);
        r[3] = rule(RuleKind.OrderRateLimit, 5, 20);
        r[4] = rule(RuleKind.LossCooldown, 10e6, 150);
        r[5] = rule(RuleKind.MaxDrawdown, 500, 0);
    }

    function createMandate(Rule[] memory rules) internal {
        vm.prank(backer);
        mandateId = registry.createMandate(address(account), rules, keccak256("nansen-report"), 600);
    }

    /// Mandate + live session key + Perpl account funded with the account's AUSD.
    function setUpTrading(Rule[] memory rules) internal {
        createMandate(rules);
        vm.prank(backer);
        account.setSessionKey(agent, uint64(block.number + 100_000));
        MandateAccount.Call[] memory calls = new MandateAccount.Call[](2);
        calls[0] = MandateAccount.Call(address(ausd), abi.encodeCall(ausd.approve, (address(perpl), type(uint256).max)));
        calls[1] = MandateAccount.Call(address(perpl), abi.encodeCall(IPerplExchange.createAccount, (1_000e6)));
        vm.prank(agent);
        account.execute(calls);
    }

    // ------------------------------------------------------------ orders

    function order(uint256 perpId, uint8 orderType, uint256 lot)
        internal
        pure
        returns (IPerplExchange.OrderDesc memory d)
    {
        d.perpId = perpId;
        d.orderType = orderType;
        d.lotLNS = lot;
        d.immediateOrCancel = true;
        d.leverageHdths = 2_000; // 20x per-position margin on the venue; account leverage is what the rules see
        d.maxNegPnlCollatBPS = 1_000;
    }

    function orderCall(IPerplExchange.OrderDesc memory d) internal view returns (MandateAccount.Call[] memory calls) {
        IPerplExchange.OrderDesc[] memory descs = new IPerplExchange.OrderDesc[](1);
        descs[0] = d;
        calls = new MandateAccount.Call[](1);
        calls[0] = MandateAccount.Call(address(perpl), abi.encodeCall(IPerplExchange.execOrders, (descs, true)));
    }

    function openLong(uint256 perpId, uint256 lot) internal view returns (MandateAccount.Call[] memory) {
        return orderCall(order(perpId, 0, lot));
    }

    function closeLong(uint256 perpId, uint256 lot) internal view returns (MandateAccount.Call[] memory) {
        return orderCall(order(perpId, 2, lot));
    }

    /// BTC lots (1e-5 BTC) worth `usd` dollars at the default mark.
    function btcLots(uint256 usd) internal pure returns (uint256) {
        return usd * 1e5 * 10 / BTC_MARK;
    }

    /// ETH lots (1e-3 ETH) worth `usd` dollars at the default mark ($2,730).
    function ethLots(uint256 usd) internal pure returns (uint256) {
        return usd * 1e5 / ETH_MARK;
    }

    function exec(MandateAccount.Call[] memory calls) internal {
        vm.prank(agent);
        account.execute(calls);
    }
}
