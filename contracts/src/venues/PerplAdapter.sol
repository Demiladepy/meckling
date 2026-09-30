// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVenue} from "./IVenue.sol";
import {IPerplExchange} from "./IPerplExchange.sol";

/// @notice IVenue for Perpl (spike S1). Stateless apart from a permissionless cache of per-market decimals read
///         from the exchange itself, so no admin can change how positions are valued.
contract PerplAdapter is IVenue {
    // Perpl order types (dex-sdk crates/sdk/src/types/request.rs).
    uint8 internal constant OPEN_LONG = 0;
    uint8 internal constant OPEN_SHORT = 1;
    uint8 internal constant CLOSE_LONG = 2;
    uint8 internal constant CLOSE_SHORT = 3;
    uint8 internal constant CANCEL = 4;
    uint8 internal constant INCREASE_COLLATERAL = 5;

    /// Bank offsets of Perpl's position bitmap: bank1 holds perps 0..252, the others 256 each.
    uint256 internal constant BANK1_BITS = 253;
    uint256 internal constant BANK1_MASK = (uint256(1) << BANK1_BITS) - 1;

    IPerplExchange public immutable perpl;
    address public immutable override collateralToken;
    uint256 public immutable collateralDecimals;

    struct MarketConfig {
        uint8 priceDecimals;
        uint8 lotDecimals;
        bool synced;
    }

    mapping(uint256 perpId => MarketConfig) public marketConfig;

    event MarketSynced(uint256 indexed perpId, uint256 priceDecimals, uint256 lotDecimals);

    error MarketUnknown(uint256 perpId);

    constructor(IPerplExchange perpl_) {
        perpl = perpl_;
        (,,, uint256 cd, address token,) = perpl_.getExchangeInfo();
        collateralToken = token;
        collateralDecimals = cd;
    }

    function exchange() external view override returns (address) {
        return address(perpl);
    }

    /// Caches a market's decimals from the exchange. Anyone may call; values come only from Perpl.
    function syncMarket(uint256 perpId) external {
        IPerplExchange.PerpetualInfo memory info = perpl.getPerpetualInfo(perpId);
        if (info.priceDecimals == 0 && info.lotDecimals == 0 && bytes(info.symbol).length == 0) {
            revert MarketUnknown(perpId);
        }
        marketConfig[perpId] = MarketConfig(uint8(info.priceDecimals), uint8(info.lotDecimals), true);
        emit MarketSynced(perpId, info.priceDecimals, info.lotDecimals);
    }

    function _decimals(uint256 perpId) internal view returns (uint256 priceDec, uint256 lotDec) {
        MarketConfig memory c = marketConfig[perpId];
        if (c.synced) return (c.priceDecimals, c.lotDecimals);
        IPerplExchange.PerpetualInfo memory info = perpl.getPerpetualInfo(perpId);
        return (info.priceDecimals, info.lotDecimals);
    }

    /// |lot| * price in collateral units.
    function notionalOf(uint256 perpId, uint256 lotLNS, uint256 pricePNS) public view returns (uint256) {
        (uint256 pd, uint256 ld) = _decimals(perpId);
        return lotLNS * pricePNS * 10 ** collateralDecimals / 10 ** (pd + ld);
    }

    function _account(address account) internal view returns (bool exists, IPerplExchange.AccountInfo memory info) {
        try perpl.getAccountByAddr(account) returns (IPerplExchange.AccountInfo memory i) {
            return (i.accountId != 0, i);
        } catch {
            return (false, info);
        }
    }

    function _market(uint256 accountId, uint256 perpId) internal view returns (MarketState memory m, int256 deposit) {
        (IPerplExchange.PositionInfo memory p, uint256 mark, bool valid) = perpl.getPosition(perpId, accountId);
        m.marketId = perpId;
        m.mark = mark;
        m.markValid = valid;
        if (accountId == 0 || p.lotLNS == 0) return (m, 0);
        m.size = p.positionType == 0 ? int256(p.lotLNS) : -int256(p.lotLNS);
        m.notional = notionalOf(perpId, p.lotLNS, mark);
        m.upnl = p.deltaPnlCNS + p.premiumPnlCNS;
        deposit = int256(p.depositCNS);
    }

    function _openPerps(IPerplExchange.PositionBitMap memory b) internal pure returns (uint256[] memory ids) {
        uint256[4] memory banks = [b.bank1, b.bank2, b.bank3, b.bank4];
        uint256 n;
        for (uint256 k; k < 4; ++k) {
            n += _popcount(k == 0 ? banks[0] & BANK1_MASK : banks[k]);
        }
        ids = new uint256[](n);
        uint256 j;
        for (uint256 k; k < 4 && j < n; ++k) {
            uint256 bank = k == 0 ? banks[0] & BANK1_MASK : banks[k];
            uint256 offset = k == 0 ? 0 : BANK1_BITS + (k - 1) * 256;
            while (bank != 0) {
                uint256 bit = _lowestBit(bank);
                ids[j++] = offset + bit;
                bank &= bank - 1;
            }
        }
    }

    function _popcount(uint256 x) internal pure returns (uint256 c) {
        while (x != 0) {
            x &= x - 1;
            ++c;
        }
    }

    function _lowestBit(uint256 x) internal pure returns (uint256 i) {
        while (x & 1 == 0) {
            x >>= 1;
            ++i;
        }
    }

    /// @inheritdoc IVenue
    function accountState(address account) external view override returns (AccountState memory s) {
        s.equity = int256(IERC20(collateralToken).balanceOf(account));
        (bool exists, IPerplExchange.AccountInfo memory info) = _account(account);
        if (!exists) return s;

        s.equity += int256(info.balanceCNS + info.lockedBalanceCNS);
        s.marginUsed = info.lockedBalanceCNS;

        uint256[] memory ids = _openPerps(info.positions);
        MarketState[] memory tmp = new MarketState[](ids.length);
        uint256 n;
        for (uint256 i; i < ids.length; ++i) {
            (MarketState memory m, int256 deposit) = _market(info.accountId, ids[i]);
            if (m.size == 0) continue;
            tmp[n++] = m;
            s.equity += deposit + m.upnl;
            s.marginUsed += uint256(deposit);
            s.totalNotional += m.notional;
        }
        s.markets = new MarketState[](n);
        for (uint256 i; i < n; ++i) {
            s.markets[i] = tmp[i];
        }
    }

    /// @inheritdoc IVenue
    function marketState(address account, uint256 marketId) external view override returns (MarketState memory m) {
        (bool exists, IPerplExchange.AccountInfo memory info) = _account(account);
        (m,) = _market(exists ? info.accountId : 0, marketId);
    }

    /// @inheritdoc IVenue
    /// @dev Allowed calls (everything else is refused, notably allowOrderForwarding and withdrawCollateral):
    ///      token:    approve(exchange, x)
    ///      exchange: createAccount, depositCollateral, increasePositionCollateral,
    ///                execOrder / execOrders where each order is
    ///                  - OpenLong/OpenShort with immediateOrCancel or fillOrKill (never resting), not in close-only
    ///                  - CloseLong/CloseShort (reduce-only by type), Cancel, or IncreasePositionCollateral
    ///                Change (type 6) is refused: it can grow a resting order after the rule check.
    function inspectCall(address target, bytes calldata data, bool closeOnly)
        external
        view
        override
        returns (CallCheck memory c)
    {
        if (data.length < 4) return c;
        bytes4 sel = bytes4(data[:4]);

        if (target == collateralToken) {
            if (sel != IERC20.approve.selector) return c;
            (address spender,) = abi.decode(data[4:], (address, uint256));
            c.allowed = spender == address(perpl);
            return c;
        }
        if (target != address(perpl)) return c;

        if (sel == IPerplExchange.depositCollateral.selector || sel == IPerplExchange.createAccount.selector) {
            c.allowed = true;
        } else if (sel == IPerplExchange.increasePositionCollateral.selector) {
            c.allowed = true; // adds margin to an existing position; never increases exposure
        } else if (sel == IPerplExchange.execOrders.selector) {
            (IPerplExchange.OrderDesc[] memory descs,) = abi.decode(data[4:], (IPerplExchange.OrderDesc[], bool));
            c.allowed = descs.length > 0;
            for (uint256 i; i < descs.length && c.allowed; ++i) {
                (bool ok, bool placed) = _checkOrder(descs[i], closeOnly);
                c.allowed = ok;
                if (placed) ++c.ordersPlaced;
            }
        } else if (sel == IPerplExchange.execOrder.selector) {
            IPerplExchange.OrderDesc memory d = abi.decode(data[4:], (IPerplExchange.OrderDesc));
            (bool ok, bool placed) = _checkOrder(d, closeOnly);
            c.allowed = ok;
            c.ordersPlaced = placed ? 1 : 0;
        }
        if (!c.allowed) c.ordersPlaced = 0;
    }

    function _checkOrder(IPerplExchange.OrderDesc memory d, bool closeOnly)
        internal
        pure
        returns (bool ok, bool placed)
    {
        uint8 t = d.orderType;
        if (t == OPEN_LONG || t == OPEN_SHORT) {
            return (!closeOnly && (d.immediateOrCancel || d.fillOrKill) && !d.postOnly, true);
        }
        if (t == CLOSE_LONG || t == CLOSE_SHORT) return (true, true);
        if (t == CANCEL || t == INCREASE_COLLATERAL) return (true, false);
        return (false, false);
    }

    /// @inheritdoc IVenue
    function orderPriceDeviationBps(address account, bytes calldata data)
        external
        view
        override
        returns (uint256 worst)
    {
        if (data.length < 4) return 0;
        bytes4 sel = bytes4(data[:4]);
        IPerplExchange.OrderDesc[] memory descs;
        if (sel == IPerplExchange.execOrders.selector) {
            (descs,) = abi.decode(data[4:], (IPerplExchange.OrderDesc[], bool));
        } else if (sel == IPerplExchange.execOrder.selector) {
            descs = new IPerplExchange.OrderDesc[](1);
            descs[0] = abi.decode(data[4:], (IPerplExchange.OrderDesc));
        } else {
            return 0;
        }
        (bool exists, IPerplExchange.AccountInfo memory info) = _account(account);
        uint256 accountId = exists ? info.accountId : 0;
        for (uint256 i; i < descs.length; ++i) {
            uint8 t = descs[i].orderType;
            if (t != OPEN_LONG && t != OPEN_SHORT) continue; // closes, cancels and margin changes are never measured
            uint256 d = _deviationBps(descs[i], accountId);
            if (d > worst) worst = d;
        }
    }

    /// Distance of an order's limit price from the mark in bps, rounded up so a hair over the limit never passes.
    function _deviationBps(IPerplExchange.OrderDesc memory d, uint256 accountId) internal view returns (uint256) {
        if (d.pricePNS == 0) return type(uint256).max; // no limit price: unbounded
        try perpl.getPosition(d.perpId, accountId) returns (
            IPerplExchange.PositionInfo memory, uint256 mark, bool valid
        ) {
            if (!valid || mark == 0) {
                return type(uint256).max;
            }
            uint256 diff = d.pricePNS > mark ? d.pricePNS - mark : mark - d.pricePNS;
            return (diff * 10_000 + mark - 1) / mark;
        } catch {
            return type(uint256).max; // no mark to measure against: treat as unbounded
        }
    }

    /// @inheritdoc IVenue
    function encodeWithdraw(uint256 amount) external view override returns (address target, bytes memory data) {
        return (address(perpl), abi.encodeCall(IPerplExchange.withdrawCollateral, (amount)));
    }

    /// @inheritdoc IVenue
    function priceScale(uint256 marketId) external view override returns (uint256) {
        (uint256 pd,) = _decimals(marketId);
        return 10 ** pd;
    }

    /// @inheritdoc IVenue
    /// @dev One IOC reduce-only order per open position, priced `slippageBps` through the mark so it crosses the book.
    ///      Longs close with CloseLong (a sell, priced below mark); shorts with CloseShort (a buy, priced above).
    function encodeCloseAll(address account, uint256 slippageBps)
        external
        view
        override
        returns (address[] memory targets, bytes[] memory datas)
    {
        (bool exists, IPerplExchange.AccountInfo memory info) = _account(account);
        if (!exists) return (targets, datas);
        uint256[] memory ids = _openPerps(info.positions);

        IPerplExchange.OrderDesc[] memory descs = new IPerplExchange.OrderDesc[](ids.length);
        uint256 n;
        for (uint256 i; i < ids.length; ++i) {
            (IPerplExchange.PositionInfo memory p, uint256 mark,) = perpl.getPosition(ids[i], info.accountId);
            if (p.lotLNS == 0) continue;
            bool isLong = p.positionType == 0;
            descs[n++] = IPerplExchange.OrderDesc({
                orderDescId: block.number,
                perpId: ids[i],
                orderType: isLong ? CLOSE_LONG : CLOSE_SHORT,
                orderId: 0,
                pricePNS: isLong ? mark * (10_000 - slippageBps) / 10_000 : mark * (10_000 + slippageBps) / 10_000,
                lotLNS: p.lotLNS,
                expiryBlock: 0,
                postOnly: false,
                fillOrKill: false,
                immediateOrCancel: true,
                maxMatches: 0,
                leverageHdths: 0,
                lastExecutionBlock: 0,
                amountCNS: 0,
                maxNegPnlCollatBPS: 10_000
            });
        }
        if (n == 0) return (targets, datas);

        IPerplExchange.OrderDesc[] memory batch = new IPerplExchange.OrderDesc[](n);
        for (uint256 i; i < n; ++i) {
            batch[i] = descs[i];
        }
        targets = new address[](1);
        datas = new bytes[](1);
        targets[0] = address(perpl);
        // revertOnFail = false: one market that cannot be closed must not block the rest of the unwind.
        datas[0] = abi.encodeCall(IPerplExchange.execOrders, (batch, false));
    }
}
