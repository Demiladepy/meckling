// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerplExchange} from "../../src/venues/IPerplExchange.sol";

contract MockAUSD is ERC20 {
    constructor() ERC20("Agora USD", "AUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Minimal Perpl exchange for unit tests. Models what Mandate relies on, as observed on the mainnet fork
///         (docs/spikes.md S1): accounts keyed by msg.sender, isolated margin per position (deposit = notional /
///         leverage), unrealized PnL at mark, the positions bitmap, and getAccountByAddr reverting for unknown
///         addresses. Orders fill immediately and fully at the mark if the limit allows; there is no book, no fees.
contract MockPerplExchange {
    error AccountNotFound(address account);
    error MockUnsupported(string what);

    struct Pos {
        uint8 positionType; // 0 long, 1 short
        uint256 lot;
        uint256 entry;
        uint256 deposit;
    }

    struct Market {
        bool exists;
        uint256 priceDecimals;
        uint256 lotDecimals;
        uint256 mark;
        bool markValid;
    }

    IERC20 public immutable token;
    uint256 public constant MIN_OPEN = 10e6;

    uint256 public accountCount;
    mapping(address => uint256) public accountIdOf;
    mapping(uint256 => address) public addrOf;
    mapping(uint256 => uint256) public balance;
    mapping(uint256 => mapping(uint256 => Pos)) public positions; // perpId => accountId => Pos
    mapping(uint256 => Market) public markets;
    mapping(uint256 => uint256[4]) internal _bitmap;
    mapping(address => bool) public forwardingAllowed;
    uint256 public ordersExecuted;

    constructor(IERC20 token_) {
        token = token_;
    }

    // ------------------------------------------------------------ test controls

    function addMarket(uint256 perpId, uint256 priceDecimals, uint256 lotDecimals, uint256 mark) external {
        markets[perpId] = Market(true, priceDecimals, lotDecimals, mark, true);
    }

    function setMark(uint256 perpId, uint256 mark) external {
        markets[perpId].mark = mark;
    }

    // ------------------------------------------------------------ account

    function createAccount(uint256 amountCNS) external returns (uint256 id) {
        require(accountIdOf[msg.sender] == 0, "exists");
        require(amountCNS >= MIN_OPEN, "min open");
        token.transferFrom(msg.sender, address(this), amountCNS);
        id = ++accountCount;
        accountIdOf[msg.sender] = id;
        addrOf[id] = msg.sender;
        balance[id] = amountCNS;
    }

    function depositCollateral(uint256 amountCNS) external {
        uint256 id = _id(msg.sender);
        token.transferFrom(msg.sender, address(this), amountCNS);
        balance[id] += amountCNS;
    }

    function withdrawCollateral(uint256 amountCNS) external {
        uint256 id = _id(msg.sender);
        balance[id] -= amountCNS;
        token.transfer(msg.sender, amountCNS);
    }

    function increasePositionCollateral(uint256 perpId, uint256 amountCNS) external {
        uint256 id = _id(msg.sender);
        balance[id] -= amountCNS;
        positions[perpId][id].deposit += amountCNS;
    }

    function allowOrderForwarding(bool allow) external {
        forwardingAllowed[msg.sender] = allow;
    }

    // ------------------------------------------------------------ orders

    function execOrders(IPerplExchange.OrderDesc[] calldata descs, bool)
        external
        returns (IPerplExchange.OrderSignature[] memory sigs)
    {
        sigs = new IPerplExchange.OrderSignature[](descs.length);
        uint256 id = _id(msg.sender);
        for (uint256 i; i < descs.length; ++i) {
            _exec(id, descs[i]);
        }
    }

    function execOrder(IPerplExchange.OrderDesc calldata d) external returns (IPerplExchange.OrderSignature memory) {
        _exec(_id(msg.sender), d);
        return IPerplExchange.OrderSignature(0, 0);
    }

    function _exec(uint256 id, IPerplExchange.OrderDesc calldata d) internal {
        Market memory mk = markets[d.perpId];
        require(mk.exists, "no market");
        uint8 t = d.orderType;
        if (t == 4 || t == 5) return; // cancel / collateral: no resting orders in the mock
        if (t > 3) revert MockUnsupported("order type");
        ++ordersExecuted;
        bool buy = t == 0 || t == 3;
        // Limit check: a buy fills only if limit >= mark, a sell only if limit <= mark (0 = market).
        if (d.pricePNS != 0 && (buy ? d.pricePNS < mk.mark : d.pricePNS > mk.mark)) return;

        Pos storage p = positions[d.perpId][id];
        if (t == 0 || t == 1) {
            uint8 side = t == 0 ? 0 : 1;
            if (p.lot != 0 && p.positionType != side) revert MockUnsupported("flip");
            uint256 notional = _notional(d.perpId, d.lotLNS, mk.mark);
            uint256 lev = d.leverageHdths == 0 ? 100 : d.leverageHdths;
            uint256 dep = notional * 100 / lev;
            balance[id] -= dep; // reverts on insufficient collateral
            p.entry = p.lot == 0 ? mk.mark : (p.entry * p.lot + mk.mark * d.lotLNS) / (p.lot + d.lotLNS);
            p.lot += d.lotLNS;
            p.deposit += dep;
            p.positionType = side;
            _setBit(id, d.perpId, true);
        } else {
            if (p.lot == 0) return;
            // CloseLong (2) reduces a long, CloseShort (3) reduces a short.
            if ((t == 2 && p.positionType != 0) || (t == 3 && p.positionType != 1)) return;
            uint256 lot = d.lotLNS > p.lot ? p.lot : d.lotLNS;
            int256 pnl = _pnl(d.perpId, p, mk.mark) * int256(lot) / int256(p.lot);
            uint256 dep = p.deposit * lot / p.lot;
            int256 back = int256(dep) + pnl;
            if (back > 0) balance[id] += uint256(back);
            p.deposit -= dep;
            p.lot -= lot;
            if (p.lot == 0) {
                delete positions[d.perpId][id];
                _setBit(id, d.perpId, false);
            }
        }
    }

    // ------------------------------------------------------------ views

    function getExchangeInfo()
        external
        view
        returns (uint256, uint256, uint256, uint256 collateralDecimals, address collateralToken, address)
    {
        return (0, 0, 0, 6, address(token), address(0));
    }

    function getAccountByAddr(address a) external view returns (IPerplExchange.AccountInfo memory info) {
        uint256 id = _id(a);
        uint256[4] memory b = _bitmap[id];
        info = IPerplExchange.AccountInfo({
            accountId: id,
            balanceCNS: balance[id],
            lockedBalanceCNS: 0,
            frozen: 0,
            accountAddr: a,
            positions: IPerplExchange.PositionBitMap(b[0], b[1], b[2], b[3])
        });
    }

    function getPosition(uint256 perpId, uint256 accountId)
        external
        view
        returns (IPerplExchange.PositionInfo memory info, uint256 markPricePNS, bool markPriceValid)
    {
        Market memory mk = markets[perpId];
        Pos memory p = positions[perpId][accountId];
        if (accountId != 0 && p.lot != 0) {
            int256 pnl = _pnl(perpId, p, mk.mark);
            info.accountId = accountId;
            info.positionType = p.positionType;
            info.depositCNS = p.deposit;
            info.pricePNS = p.entry;
            info.lotLNS = p.lot;
            info.pnlCNS = pnl;
            info.deltaPnlCNS = pnl;
        }
        return (info, mk.mark, mk.markValid);
    }

    function getPerpetualInfo(uint256 perpId) external view returns (IPerplExchange.PerpetualInfo memory info) {
        Market memory mk = markets[perpId];
        if (!mk.exists) return info;
        info.symbol = "MOCK";
        info.priceDecimals = mk.priceDecimals;
        info.lotDecimals = mk.lotDecimals;
        info.markPNS = mk.mark;
    }

    // ------------------------------------------------------------ internal

    function _id(address a) internal view returns (uint256 id) {
        id = accountIdOf[a];
        if (id == 0) revert AccountNotFound(a);
    }

    function _notional(uint256 perpId, uint256 lot, uint256 price) internal view returns (uint256) {
        Market memory mk = markets[perpId];
        return lot * price * 1e6 / 10 ** (mk.priceDecimals + mk.lotDecimals);
    }

    function _pnl(uint256 perpId, Pos memory p, uint256 mark) internal view returns (int256) {
        int256 diff = int256(_notional(perpId, p.lot, mark)) - int256(_notional(perpId, p.lot, p.entry));
        return p.positionType == 0 ? diff : -diff;
    }

    /// Same layout as Perpl: bank1 holds perps 0..252, then 256 per bank.
    function _setBit(uint256 id, uint256 perpId, bool on) internal {
        (uint256 bank, uint256 bit) = perpId < 253 ? (0, perpId) : (1 + (perpId - 253) / 256, (perpId - 253) % 256);
        if (on) _bitmap[id][bank] |= (uint256(1) << bit);
        else _bitmap[id][bank] &= ~(uint256(1) << bit);
    }
}
