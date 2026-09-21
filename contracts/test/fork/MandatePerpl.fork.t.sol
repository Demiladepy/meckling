// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange} from "../../src/venues/IPerplExchange.sol";
import {PerplAdapter} from "../../src/venues/PerplAdapter.sol";
import {IVenue} from "../../src/venues/IVenue.sol";
import {MandateRegistry} from "../../src/MandateRegistry.sol";
import {MandateAccount, IMandateRules} from "../../src/MandateAccount.sol";
import {MandateAccountFactory} from "../../src/MandateAccountFactory.sol";
import {Rule, RuleKind} from "../../src/rules/RuleTypes.sol";

/// The full Mandate stack against the real Perpl exchange on a Monad mainnet fork: a trade inside the mandate fills
/// on Perpl, a 12x trade against a 3x limit reverts with MandateViolation, and the adapter's equity matches Perpl's
/// own accounting.
contract MandatePerplForkTest is Test {
    IPerplExchange constant EX = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint256 constant BTC = 1;
    uint256 constant ETH = 20;

    address backer = makeAddr("backer");
    address agent = makeAddr("agent");

    PerplAdapter adapter;
    MandateRegistry registry;
    MandateAccountFactory factory;
    MandateAccount account;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("monad"));
        adapter = new PerplAdapter(EX);
        adapter.syncMarket(BTC);
        adapter.syncMarket(ETH);
        registry = new MandateRegistry(address(this));
        factory = new MandateAccountFactory(IMandateRules(address(registry)), adapter);
        registry.setFactory(address(factory));

        vm.prank(backer);
        account = factory.createAccount(address(0), bytes32("fork"));

        Rule[] memory rules = new Rule[](4);
        rules[0] = Rule(RuleKind.MaxLeverage, 30_000, 0, 0);
        rules[1] = Rule(RuleKind.AllowedMarkets, (1 << BTC) | (1 << ETH), 0, 0);
        rules[2] = Rule(RuleKind.LossCooldown, 5e6, 150, 0);
        rules[3] = Rule(RuleKind.MaxDrawdown, 500, 0, 0);
        vm.startPrank(backer);
        registry.createMandate(address(account), rules, keccak256("report"), 600);
        account.setSessionKey(agent, uint64(block.number + 10_000));
        vm.stopPrank();

        vm.prank(address(EX)); // AUSD packs balances; fund from a large holder (spike S1)
        AUSD.transfer(address(account), 100e6);

        MandateAccount.Call[] memory calls = new MandateAccount.Call[](2);
        calls[0] = MandateAccount.Call(address(AUSD), abi.encodeCall(IERC20.approve, (address(EX), type(uint256).max)));
        calls[1] = MandateAccount.Call(address(EX), abi.encodeCall(IPerplExchange.createAccount, (100e6)));
        vm.prank(agent);
        account.execute(calls);
    }

    function _long(uint256 perpId, uint256 lot, uint256 limitPrice)
        internal
        view
        returns (MandateAccount.Call[] memory c)
    {
        IPerplExchange.OrderDesc[] memory d = new IPerplExchange.OrderDesc[](1);
        d[0] = IPerplExchange.OrderDesc({
            orderDescId: block.number,
            perpId: perpId,
            orderType: 0,
            orderId: 0,
            pricePNS: limitPrice,
            lotLNS: lot,
            expiryBlock: 0,
            postOnly: false,
            fillOrKill: false,
            immediateOrCancel: true,
            maxMatches: 0,
            leverageHdths: 1_500,
            lastExecutionBlock: 0,
            amountCNS: 0,
            maxNegPnlCollatBPS: 1_000
        });
        c = new MandateAccount.Call[](1);
        c[0] = MandateAccount.Call(address(EX), abi.encodeCall(IPerplExchange.execOrders, (d, true)));
    }

    function test_mandateEnforcedOnRealPerpl() public {
        IVenue.AccountState memory s0 = adapter.accountState(address(account));
        assertEq(s0.equity, 100e6, "equity = deposited AUSD");
        uint256 mark = adapter.marketState(address(account), BTC).mark;

        // ~2x: 0.0024 BTC (~$200) on $100 equity fills on Perpl.
        vm.prank(agent);
        account.execute(_long(BTC, 240, mark * 101 / 100));
        IVenue.AccountState memory s1 = adapter.accountState(address(account));
        assertEq(s1.markets.length, 1, "BTC position open");
        assertEq(s1.markets[0].size, 240);
        console2.log("equity after fill (AUSD 1e-6)", uint256(s1.equity));
        console2.log("notional (AUSD 1e-6)", s1.totalNotional);
        assertApproxEqRel(uint256(s1.equity), 100e6, 0.01e18, "equity matches Perpl accounting within fees");

        // 12x: another ~$1,000 on top => ~12x total. The chain refuses inside the same transaction.
        vm.prank(agent);
        vm.expectPartialRevert(MandateAccount.MandateViolation.selector);
        account.execute(_long(BTC, 1_200, mark * 101 / 100));

        // Preflight records the attempt on-chain without executing.
        vm.prank(agent);
        assertFalse(account.preflight(_long(BTC, 1_200, mark * 101 / 100)));
        assertEq(adapter.accountState(address(account)).markets[0].size, 240, "nothing changed on-chain");
    }

    function test_gasPerEnforcedTrade() public {
        uint256 mark = adapter.marketState(address(account), BTC).mark;
        MandateAccount.Call[] memory c = _long(BTC, 120, mark * 101 / 100);
        vm.prank(agent);
        uint256 g0 = gasleft();
        account.execute(c);
        uint256 used = g0 - gasleft();
        console2.log("gas: execute with 4 rules (open 0.0012 BTC)", used);
    }
}
