// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVenue} from "./venues/IVenue.sol";
import {Rule, RuleKind, Monitor, ExecContext} from "./rules/RuleTypes.sol";
import {RuleEngine} from "./rules/RuleEngine.sol";

interface IMandateRules {
    function rulesOf(address account) external view returns (bool exists, bool active, Rule[] memory rules);
    function bondVault() external view returns (address);
}

/// @notice One per agent or self-trader. Holds AUSD and the venue position, and enforces the mandate inside every
///         trade: a call that would break an action rule reverts in the same transaction (PRD 7.3).
/// @dev Roles:
///      - owner: the capital holder (backer, or the self-trader via Mera). Sets session keys, withdraws, trades.
///      - operator: runs the agent (zero for self-mandates). Can revoke the session key, nothing else.
///      - session key: the agent. Can only call `execute`/`preflight`, until its expiry block.
contract MandateAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Call {
        address target;
        bytes data;
    }

    IMandateRules public immutable registry;
    IVenue public immutable venue;
    address public immutable exchange;
    IERC20 public immutable collateral;
    address public immutable owner;
    address public immutable operator;

    address public sessionKey;
    uint64 public sessionKeyExpiresAtBlock;
    /// Set by BondVault when a market rule breach is flagged (M2). Permanent.
    bool public breached;

    mapping(uint256 ruleIndex => Monitor) internal _monitors;

    event Executed(address indexed account, uint256 blockNumber, int256 equity, uint256 notional);
    event MonitorUpdated(address indexed account, uint256 ruleIndex, bytes32 stateHash);
    event ViolationAttempted(
        address indexed account,
        uint256 blockNumber,
        uint256 ruleIndex,
        int256 observed,
        int256 limit,
        bytes32 callsHash
    );
    event SessionKeySet(address indexed key, uint64 expiresAtBlock);
    event SessionKeyRevoked(address indexed key);
    event Withdrawn(address indexed to, uint256 amount);
    event WithdrawnFromVenue(uint256 amount);

    error MandateViolation(uint256 ruleIndex, int256 observed, int256 limit);
    error TargetNotAllowed(address target);
    error CallNotAllowed(address target, bytes4 selector);
    error CloseOnlyMode();
    error NoMandate();
    error Unauthorized();
    error PositionsOpen();
    error SimulationPassed();
    error BadExpiry();

    constructor(address owner_, address operator_, IMandateRules registry_, IVenue venue_) {
        owner = owner_;
        operator = operator_;
        registry = registry_;
        venue = venue_;
        exchange = venue_.exchange();
        collateral = IERC20(venue_.collateralToken());
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyTrader() {
        if (msg.sender != owner && !_sessionKeyValid(msg.sender)) revert Unauthorized();
        _;
    }

    // ---------------------------------------------------------------- trading

    /// @notice Performs venue calls, then checks every action rule against the post-trade state and reverts with
    ///         MandateViolation on the first one that fails. Callable by the owner or a live session key.
    function execute(Call[] calldata calls) external nonReentrant onlyTrader returns (bytes[] memory results) {
        return _execute(calls);
    }

    /// @notice Runs `calls` in a simulation that is always rolled back, and emits ViolationAttempted if the trade
    ///         would break a rule. Informational only: `execute` enforces independently (PRD 10.3).
    /// @return ok true if the trade would pass every action rule.
    function preflight(Call[] calldata calls) external nonReentrant onlyTrader returns (bool ok) {
        try this.simulate(calls) {
        // simulate always reverts
        }
        catch (bytes memory reason) {
            if (reason.length >= 4 && bytes4(reason) == SimulationPassed.selector) return true;
            if (reason.length == 100 && bytes4(reason) == MandateViolation.selector) {
                (uint256 ruleIndex, int256 observed, int256 limit) =
                    abi.decode(_slice4(reason), (uint256, int256, int256));
                emit ViolationAttempted(
                    address(this), block.number, ruleIndex, observed, limit, keccak256(abi.encode(calls))
                );
                return false;
            }
            assembly ("memory-safe") {
                revert(add(reason, 32), mload(reason))
            }
        }
    }

    /// @dev Only callable by this contract, from `preflight` (which holds the reentrancy lock). Always reverts, so
    ///      nothing it does persists.
    function simulate(Call[] calldata calls) external {
        if (msg.sender != address(this)) revert Unauthorized();
        _execute(calls);
        revert SimulationPassed();
    }

    function _execute(Call[] calldata calls) internal returns (bytes[] memory results) {
        (bool exists, bool active, Rule[] memory rules) = registry.rulesOf(address(this));
        if (!exists) revert NoMandate();
        bool co = breached || !active;

        uint256 ordersPlaced;
        for (uint256 i; i < calls.length; ++i) {
            address t = calls[i].target;
            if (t != exchange && t != address(collateral)) revert TargetNotAllowed(t);
            IVenue.CallCheck memory chk = venue.inspectCall(t, calls[i].data, co);
            if (!chk.allowed) {
                if (co) revert CloseOnlyMode();
                revert CallNotAllowed(t, bytes4(calls[i].data));
            }
            ordersPlaced += chk.ordersPlaced;
        }

        ExecContext memory ctx;
        ctx.ordersPlaced = ordersPlaced;
        ctx.pre = venue.accountState(address(this));

        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory ret) = calls[i].target.call(calls[i].data);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(ret, 32), mload(ret))
                }
            }
            results[i] = ret;
        }

        ctx.post = venue.accountState(address(this));

        for (uint256 i; i < rules.length; ++i) {
            if (RuleEngine.update(_monitors[i], rules[i], ctx)) {
                Monitor storage m = _monitors[i];
                emit MonitorUpdated(address(this), i, keccak256(abi.encode(m.w0, m.w1)));
            }
        }
        // In close-only mode the adapter admits only exposure-reducing calls, and rules must never block an exit.
        if (!co) {
            for (uint256 i; i < rules.length; ++i) {
                (bool ok, int256 observed, int256 limit) = RuleEngine.checkAction(_monitors[i], rules[i], ctx);
                if (!ok) revert MandateViolation(i, observed, limit);
            }
        }
        emit Executed(address(this), block.number, ctx.post.equity, ctx.post.totalNotional);
    }

    /// @notice Updates market-rule monitors (the equity peak) from live state. Anyone can call; keepers do.
    function poke() external nonReentrant {
        (bool exists,, Rule[] memory rules) = registry.rulesOf(address(this));
        if (!exists) revert NoMandate();
        int256 equity = venue.accountState(address(this)).equity;
        for (uint256 i; i < rules.length; ++i) {
            if (rules[i].kind != RuleKind.MaxDrawdown) continue;
            Monitor storage m = _monitors[i];
            uint256 before = m.w0;
            if (equity > 0 && uint256(equity) > before) {
                m.w0 = uint256(equity);
                emit MonitorUpdated(address(this), i, keccak256(abi.encode(m.w0, m.w1)));
            }
        }
    }

    // ---------------------------------------------------------------- keys and funds

    function setSessionKey(address key, uint64 expiresAtBlock) external onlyOwner {
        if (key == address(0) || expiresAtBlock <= block.number) revert BadExpiry();
        sessionKey = key;
        sessionKeyExpiresAtBlock = expiresAtBlock;
        emit SessionKeySet(key, expiresAtBlock);
    }

    function revokeSessionKey() external {
        if (msg.sender != owner && (msg.sender != operator || operator == address(0))) revert Unauthorized();
        emit SessionKeyRevoked(sessionKey);
        sessionKey = address(0);
        sessionKeyExpiresAtBlock = 0;
    }

    /// @notice Sends idle collateral held by this account to the owner. Blocked while positions are open, unless the
    ///         account is in close-only mode. Lowers the drawdown peak by the amount so a withdrawal is never a
    ///         drawdown.
    function withdraw(uint256 amount) external nonReentrant onlyOwner {
        _requireFlatOrCloseOnly();
        _lowerPeaks(amount);
        collateral.safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    /// @notice Moves free collateral from the venue back into this account. Owner only; same restriction.
    function withdrawFromVenue(uint256 amount) external nonReentrant onlyOwner {
        _requireFlatOrCloseOnly();
        (address target, bytes memory data) = venue.encodeWithdraw(amount);
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 32), mload(ret))
            }
        }
        emit WithdrawnFromVenue(amount);
    }

    // ---------------------------------------------------------------- views

    function closeOnly() public view returns (bool) {
        (bool exists, bool active,) = registry.rulesOf(address(this));
        return breached || (exists && !active);
    }

    function monitor(uint256 ruleIndex) external view returns (Monitor memory) {
        return _monitors[ruleIndex];
    }

    function isSessionKey(address key) external view returns (bool) {
        return _sessionKeyValid(key);
    }

    // ---------------------------------------------------------------- internal

    function _sessionKeyValid(address key) internal view returns (bool) {
        return key != address(0) && key == sessionKey && block.number <= sessionKeyExpiresAtBlock;
    }

    function _requireFlatOrCloseOnly() internal view {
        if (!closeOnly() && venue.accountState(address(this)).markets.length != 0) revert PositionsOpen();
    }

    function _lowerPeaks(uint256 amount) internal {
        (bool exists,, Rule[] memory rules) = registry.rulesOf(address(this));
        if (!exists) return;
        for (uint256 i; i < rules.length; ++i) {
            if (rules[i].kind != RuleKind.MaxDrawdown) continue;
            Monitor storage m = _monitors[i];
            m.w0 = m.w0 > amount ? m.w0 - amount : 0;
            emit MonitorUpdated(address(this), i, keccak256(abi.encode(m.w0, m.w1)));
        }
    }

    function _slice4(bytes memory b) internal pure returns (bytes memory out) {
        out = new bytes(b.length - 4);
        for (uint256 i; i < out.length; ++i) {
            out[i] = b[i + 4];
        }
    }
}
