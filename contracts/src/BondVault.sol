// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IVenue} from "./venues/IVenue.sol";
import {MandateRegistry} from "./MandateRegistry.sol";
import {MandateAccount} from "./MandateAccount.sol";
import {OracleGuard} from "./OracleGuard.sol";
import {Rule, Monitor} from "./rules/RuleTypes.sol";
import {RuleEngine} from "./rules/RuleEngine.sol";

/// @notice The operator's skin in the game (PRD 7.6). Anyone may report that the market broke a market rule, but the
///         report only succeeds if this contract recomputes the breach from live on-chain state and the oracle guard
///         agrees the marks are trustworthy. The account then unwinds, and after a dispute window the bond pays the
///         backer.
/// @dev No admin can move a bond. The arbiter, fixed at deployment, can only resolve a dispute that an operator
///      raised, and a rejected dispute simply lets the normal slash proceed.
contract BondVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Breach {
        address account;
        uint64 ruleIndex;
        uint64 blockNumber;
        int256 observed;
        int256 limit;
        uint256 peakEquity; // the monitor's equity peak when flagged
        int256 equityAtFlag;
        address reporter;
        bool disputed;
        bool resolved;
        bool upheld; // true once an arbiter confirms a disputed breach
        bool slashed;
    }

    IERC20 public immutable collateral;
    MandateRegistry public immutable registry;
    IVenue public immutable venue;
    OracleGuard public immutable guard;
    /// @notice Resolves disputes. Set once at deployment; for the demo this is a named address (PRD open question 4).
    address public immutable arbiter;
    /// @notice Slippage allowed when unwinding a breached account, in bps of the mark.
    uint256 public immutable unwindSlippageBps;

    mapping(address account => uint256) public bondOf;
    mapping(address account => address) public operatorOf;
    mapping(address account => uint256) public openBreachOf; // breachId + 1 while a breach is unresolved
    Breach[] internal _breaches;

    event BondPosted(address indexed account, address indexed operator, uint256 amount);
    event BreachFlagged(
        uint256 indexed breachId,
        address indexed account,
        uint256 ruleIndex,
        int256 observed,
        int256 limit,
        uint256 blockNumber
    );
    event Disputed(uint256 indexed breachId, bytes reason);
    event DisputeResolved(uint256 indexed breachId, bool upheld);
    event Slashed(uint256 indexed breachId, address indexed backer, uint256 amount);
    event BondWithdrawn(address indexed account, address indexed operator, uint256 amount);

    error UnknownMandate();
    error NotMarketRule();
    error MarksNotTrusted();
    error NoBreach();
    error BreachPending();
    error AlreadySlashed();
    error DisputeWindowOpen();
    error DisputeWindowClosed();
    error NotOperator();
    error NotArbiter();
    error AlreadyDisputed();
    error DisputeUnresolved();
    error NothingPosted();
    error MandateActive();

    constructor(
        IERC20 collateral_,
        MandateRegistry registry_,
        IVenue venue_,
        OracleGuard guard_,
        address arbiter_,
        uint256 unwindSlippageBps_
    ) {
        collateral = collateral_;
        registry = registry_;
        venue = venue_;
        guard = guard_;
        arbiter = arbiter_;
        unwindSlippageBps = unwindSlippageBps_;
    }

    function breachCount() external view returns (uint256) {
        return _breaches.length;
    }

    function getBreach(uint256 breachId) external view returns (Breach memory) {
        return _breaches[breachId];
    }

    // ---------------------------------------------------------------- bond

    /// @notice Posts (or tops up) the bond backing `account`. The operator keeps no claim on it while a breach is open.
    function postBond(address account, uint256 amount) external nonReentrant {
        (MandateRegistry.Mandate memory m,) = _mandate(account);
        if (operatorOf[account] == address(0)) operatorOf[account] = msg.sender;
        collateral.safeTransferFrom(msg.sender, address(this), amount);
        bondOf[account] += amount;
        emit BondPosted(account, m.operator == address(0) ? msg.sender : m.operator, amount);
    }

    /// @notice Returns the bond once the mandate is over and no breach is pending.
    function withdrawBond(address account) external nonReentrant {
        if (operatorOf[account] != msg.sender) revert NotOperator();
        (MandateRegistry.Mandate memory m,) = _mandate(account);
        if (m.active) revert MandateActive();
        if (openBreachOf[account] != 0) revert BreachPending();
        uint256 amount = bondOf[account];
        if (amount == 0) revert NothingPosted();
        bondOf[account] = 0;
        collateral.safeTransfer(msg.sender, amount);
        emit BondWithdrawn(account, msg.sender, amount);
    }

    // ---------------------------------------------------------------- breaches

    /// @notice Reports that market rule `ruleIndex` is broken. Callable by anyone; it succeeds only if this contract
    ///         recomputes the violation from live state. On success the account unwinds and enters close-only mode.
    function flagBreach(address account, uint256 ruleIndex) external nonReentrant returns (uint256 breachId) {
        (MandateRegistry.Mandate memory m, Rule[] memory rules) = _mandate(account);
        if (!m.active) revert MandateActive();
        if (openBreachOf[account] != 0) revert BreachPending();
        if (ruleIndex >= rules.length || !RuleEngine.isMarketRule(rules[ruleIndex].kind)) revert NotMarketRule();
        if (!guard.accountMarksTrusted(account)) revert MarksNotTrusted();

        MandateAccount acct = MandateAccount(account);
        Monitor memory monitor = acct.monitor(ruleIndex);
        int256 equity = venue.accountState(account).equity;
        (bool ok, int256 observed, int256 limit) = _checkMarketRule(rules[ruleIndex], monitor, equity);
        if (ok) revert NoBreach();

        breachId = _breaches.length;
        _breaches.push(
            Breach({
                account: account,
                ruleIndex: uint64(ruleIndex),
                blockNumber: uint64(block.number),
                observed: observed,
                limit: limit,
                peakEquity: monitor.w0,
                equityAtFlag: equity,
                reporter: msg.sender,
                disputed: false,
                resolved: false,
                upheld: false,
                slashed: false
            })
        );
        openBreachOf[account] = breachId + 1;

        acct.unwind(unwindSlippageBps);
        emit BreachFlagged(breachId, account, ruleIndex, observed, limit, block.number);
    }

    /// @notice The operator contests a breach within the dispute window.
    function dispute(uint256 breachId, bytes calldata reason) external {
        Breach storage b = _breaches[breachId];
        if (operatorOf[b.account] != msg.sender) revert NotOperator();
        (MandateRegistry.Mandate memory m,) = _mandate(b.account);
        if (block.number > b.blockNumber + m.disputeWindowBlocks) revert DisputeWindowClosed();
        if (b.disputed) revert AlreadyDisputed();
        b.disputed = true;
        emit Disputed(breachId, reason);
    }

    /// @notice The arbiter resolves a dispute. `upheld` means the breach stands and the bond can be slashed.
    function resolveDispute(uint256 breachId, bool upheld) external {
        if (msg.sender != arbiter) revert NotArbiter();
        Breach storage b = _breaches[breachId];
        if (!b.disputed || b.resolved) revert DisputeUnresolved();
        b.resolved = true;
        b.upheld = upheld;
        if (!upheld) openBreachOf[b.account] = 0; // the breach is withdrawn; the bond stays with the operator
        emit DisputeResolved(breachId, upheld);
    }

    /// @notice Pays the backer from the bond, after the dispute window with no open dispute (or an upheld one).
    ///         The payout is the backer's loss from the equity peak, capped at the bond.
    function slash(uint256 breachId) external nonReentrant {
        Breach storage b = _breaches[breachId];
        if (b.slashed) revert AlreadySlashed();
        (MandateRegistry.Mandate memory m,) = _mandate(b.account);
        if (b.disputed) {
            if (!b.resolved) revert DisputeUnresolved();
            if (!b.upheld) revert NoBreach();
        } else if (block.number <= b.blockNumber + m.disputeWindowBlocks) {
            revert DisputeWindowOpen();
        }

        uint256 equity = b.equityAtFlag > 0 ? uint256(b.equityAtFlag) : 0;
        uint256 loss = b.peakEquity > equity ? b.peakEquity - equity : 0;
        uint256 bond = bondOf[b.account];
        uint256 amount = loss < bond ? loss : bond;

        b.slashed = true;
        openBreachOf[b.account] = 0;
        bondOf[b.account] = bond - amount;
        if (amount > 0) collateral.safeTransfer(m.backer, amount);
        emit Slashed(breachId, m.backer, amount);
    }

    // ---------------------------------------------------------------- internal

    function _mandate(address account) internal view returns (MandateRegistry.Mandate memory m, Rule[] memory rules) {
        uint256 id = registry.mandateIdOf(account);
        if (id == 0) revert UnknownMandate();
        (m, rules) = registry.getMandate(id);
    }

    /// @dev Recomputes a market rule from a monitor snapshot, mirroring RuleEngine.checkMarket without storage.
    function _checkMarketRule(Rule memory r, Monitor memory monitor, int256 equity)
        internal
        pure
        returns (bool ok, int256 observed, int256 limit)
    {
        limit = int256(r.p1);
        uint256 peak = monitor.w0;
        if (peak == 0) return (true, 0, limit);
        uint256 eq = equity > 0 ? uint256(equity) : 0;
        observed = eq >= peak ? int256(0) : int256((peak - eq) * 10_000 / peak);
        ok = eq * 10_000 >= peak * (10_000 - r.p1);
    }
}
