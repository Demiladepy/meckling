// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange} from "../../src/venues/IPerplExchange.sol";

/// @dev A bare smart contract that trades on Perpl in its own name. Stands in for MandateAccount.
contract ProbeAccount {
    IPerplExchange public immutable ex;
    IERC20 public immutable ausd;

    constructor(IPerplExchange ex_, IERC20 ausd_) {
        ex = ex_;
        ausd = ausd_;
    }

    function open(uint256 amount) external returns (uint256) {
        ausd.approve(address(ex), type(uint256).max);
        return ex.createAccount(amount);
    }

    function deposit(uint256 amount) external {
        ex.depositCollateral(amount);
    }

    function orders(IPerplExchange.OrderDesc[] calldata descs)
        external
        returns (IPerplExchange.OrderSignature[] memory)
    {
        return ex.execOrders(descs, true);
    }
}

/// Spike S1: can a contract account (not an EOA) deposit AUSD, place and cancel orders, and hold a position on Perpl?
/// Run: forge test --match-path test/fork/* -vv  (FOUNDRY_PROFILE=fork, MONAD_RPC_URL set)
contract PerplContractAccountForkTest is Test {
    IPerplExchange constant EX = IPerplExchange(0x34B6552d57a35a1D042CcAe1951BD1C370112a6F);
    IERC20 constant AUSD = IERC20(0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a);
    uint256 constant BTC = 1; // mainnet perpId; priceDecimals 1, lotDecimals 5

    ProbeAccount probe;

    function setUp() public {
        vm.createSelectFork(vm.rpcUrl("monad"));
        probe = new ProbeAccount(EX, AUSD);
        // AUSD packs balances, so deal() cannot write them; fund from the exchange (a large AUSD holder).
        vm.prank(address(EX));
        AUSD.transfer(address(probe), 1_000e6);
    }

    function _desc(uint8 orderType, uint256 price, uint256 lot, uint256 orderId, bool postOnly, bool ioc)
        internal
        view
        returns (IPerplExchange.OrderDesc[] memory d)
    {
        d = new IPerplExchange.OrderDesc[](1);
        d[0] = IPerplExchange.OrderDesc({
            orderDescId: block.number,
            perpId: BTC,
            orderType: orderType,
            orderId: orderId,
            pricePNS: price,
            lotLNS: lot,
            expiryBlock: 0,
            postOnly: postOnly,
            fillOrKill: false,
            immediateOrCancel: ioc,
            maxMatches: 0,
            leverageHdths: 200,
            lastExecutionBlock: 0,
            amountCNS: 0,
            maxNegPnlCollatBPS: 1000
        });
    }

    function test_contractAccountCanTradeOnPerpl() public {
        assertEq(AUSD.balanceOf(address(probe)), 1_000e6, "deal AUSD");

        uint256 accountId = probe.open(100e6);
        IPerplExchange.AccountInfo memory info = EX.getAccountByAddr(address(probe));
        assertEq(info.accountId, accountId, "account keyed by contract address");
        assertEq(info.accountAddr, address(probe));
        console2.log("accountId", accountId, "balanceCNS", info.balanceCNS);

        probe.deposit(50e6);
        info = EX.getAccountByAddr(address(probe));
        console2.log("balance after deposit", info.balanceCNS);

        (, uint256 mark,) = EX.getPosition(BTC, accountId);
        console2.log("BTC mark PNS", mark);

        // 1) resting post-only bid 20% below mark, then cancel it
        IPerplExchange.OrderSignature[] memory sig = probe.orders(_desc(0, mark * 80 / 100, 20, 0, true, false));
        console2.log("resting orderId", sig[0].orderId);
        (uint32 ownerAcct,,,,,,,,,,) = EX.getOrder(BTC, sig[0].orderId);
        assertEq(ownerAcct, accountId, "resting order owned by contract account");
        probe.orders(_desc(4, 0, 0, sig[0].orderId, false, false));
        (ownerAcct,,,,,,,,,,) = EX.getOrder(BTC, sig[0].orderId);
        assertTrue(ownerAcct != accountId, "order cancelled");

        // 2) marketable IOC long 0.0002 BTC at mark + 1%
        probe.orders(_desc(0, mark * 101 / 100, 20, 0, false, true));
        (IPerplExchange.PositionInfo memory pos, uint256 mark2, bool valid) = EX.getPosition(BTC, accountId);
        console2.log("position lot", pos.lotLNS, "entry price", pos.pricePNS);
        console2.log("deposit", pos.depositCNS, "mark valid", valid ? 1 : 0);
        console2.log("pnl", pos.pnlCNS);
        console2.log("mark", mark2);
        assertEq(pos.lotLNS, 20, "contract holds a BTC position");
        assertEq(pos.positionType, 0, "long");

        // 3) reduce-only IOC close at mark - 1%
        probe.orders(_desc(2, mark * 99 / 100, 20, 0, false, true));
        (pos,,) = EX.getPosition(BTC, accountId);
        assertEq(pos.lotLNS, 0, "position closed");
        info = EX.getAccountByAddr(address(probe));
        console2.log("final balanceCNS", info.balanceCNS);
    }
}
