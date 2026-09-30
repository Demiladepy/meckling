// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Rule} from "./rules/RuleTypes.sol";
import {RuleEngine} from "./rules/RuleEngine.sol";

interface IMandateAccountView {
    function owner() external view returns (address);
    function operator() external view returns (address);
}

interface IAccountFactoryView {
    function isAccount(address account) external view returns (bool);
}

/// @notice Stores each MandateAccount's mandate: its rules, the Nansen report hash that justified them, and who the
///         backer and operator are. Rules can only be tightened after creation (PRD 7.2, invariant 4).
/// @dev Admin (owner) can only: set the account factory once, set the bond vault once (M2), and pause new mandates.
///      No admin function touches funds or existing rules.
contract MandateRegistry is Ownable2Step {
    struct Mandate {
        address account;
        address backer;
        address operator; // zero for self-mandates
        bytes32 reportHash; // hash of the Nansen underwriting report (zero if none)
        uint64 createdAtBlock;
        uint64 disputeWindowBlocks;
        bool active;
    }

    IAccountFactoryView public factory;
    address public bondVault;
    bool public paused;

    uint256 public mandateCount;
    mapping(uint256 mandateId => address account) internal _accountOf;

    /// Everything one account's mandate holds: 71 slots, stored at the start of a 128-slot storage page of its own
    /// (see _book). Every execute reads the id, the active flag and the rules; Monad MIP-8 charges 8,100 gas per cold
    /// page, so keeping them on one page costs one cold read where three mappings cost four.
    struct Book {
        uint256 id;
        Mandate mandate;
        uint256 ruleCount;
        Rule[16] rules; // RuleEngine.MAX_RULES
    }

    /// Seed for the per-account pages. Changing it orphans every stored mandate.
    bytes32 private constant BOOK_SEED = keccak256("mandate.registry.book.v1");

    event MandateCreated(
        uint256 indexed mandateId, address indexed account, address indexed backer, bytes32 reportHash
    );
    event RuleSet(uint256 indexed mandateId, uint256 indexed ruleIndex, Rule rule);
    event RuleTightened(uint256 indexed mandateId, uint256 ruleIndex);
    event MandateDeactivated(uint256 indexed mandateId, address indexed account);
    event FactorySet(address factory);
    event BondVaultSet(address bondVault);
    event Paused(bool paused);

    error AlreadySet();
    error NewMandatesPaused();
    error NotFactoryAccount(address account);
    error NotAccountOwner();
    error MandateExists(address account);
    error UnknownMandate(uint256 mandateId);
    error NotBacker();
    error Inactive();
    error BadRuleCount();
    error InvalidRule(uint256 ruleIndex);
    error NotTightening(uint256 ruleIndex);

    constructor(address admin) Ownable(admin) {}

    // ---------------------------------------------------------------- admin

    function setFactory(address factory_) external onlyOwner {
        if (address(factory) != address(0)) revert AlreadySet();
        factory = IAccountFactoryView(factory_);
        emit FactorySet(factory_);
    }

    function setBondVault(address bondVault_) external onlyOwner {
        if (bondVault != address(0)) revert AlreadySet();
        bondVault = bondVault_;
        emit BondVaultSet(bondVault_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    // ---------------------------------------------------------------- mandates

    /// @notice Attaches a mandate to a MandateAccount. Only the account's owner (the backer, or the self-trader) can
    ///         create it, and each account gets exactly one mandate for its lifetime.
    function createMandate(address account, Rule[] calldata rules, bytes32 reportHash, uint64 disputeWindowBlocks)
        external
        returns (uint256 mandateId)
    {
        if (paused) revert NewMandatesPaused();
        if (address(factory) == address(0) || !factory.isAccount(account)) revert NotFactoryAccount(account);
        if (IMandateAccountView(account).owner() != msg.sender) revert NotAccountOwner();
        Book storage b = _book(account);
        if (b.id != 0) revert MandateExists(account);
        if (rules.length == 0 || rules.length > RuleEngine.MAX_RULES) revert BadRuleCount();

        mandateId = ++mandateCount;
        _accountOf[mandateId] = account;
        b.id = mandateId;
        b.mandate = Mandate({
            account: account,
            backer: msg.sender,
            operator: IMandateAccountView(account).operator(),
            reportHash: reportHash,
            createdAtBlock: uint64(block.number),
            disputeWindowBlocks: disputeWindowBlocks,
            active: true
        });
        b.ruleCount = rules.length;
        for (uint256 i; i < rules.length; ++i) {
            if (!RuleEngine.validate(rules[i])) revert InvalidRule(i);
            b.rules[i] = rules[i];
            emit RuleSet(mandateId, i, rules[i]);
        }
        emit MandateCreated(mandateId, account, msg.sender, reportHash);
    }

    /// @notice Replaces rule `ruleIndex` with a stricter version of the same kind. Backer only.
    function tightenRule(uint256 mandateId, uint256 ruleIndex, Rule calldata newRule) external {
        Book storage b = _bookOf(mandateId);
        if (msg.sender != b.mandate.backer) revert NotBacker();
        if (!b.mandate.active) revert Inactive();
        if (ruleIndex >= b.ruleCount || !RuleEngine.isTightening(b.rules[ruleIndex], newRule)) {
            revert NotTightening(ruleIndex);
        }
        b.rules[ruleIndex] = newRule;
        emit RuleSet(mandateId, ruleIndex, newRule);
        emit RuleTightened(mandateId, ruleIndex);
    }

    /// @notice Ends the mandate. The account moves to close-only mode permanently. Backer only.
    function deactivate(uint256 mandateId) external {
        Mandate storage m = _bookOf(mandateId).mandate;
        if (msg.sender != m.backer) revert NotBacker();
        if (!m.active) revert Inactive();
        m.active = false;
        emit MandateDeactivated(mandateId, m.account);
    }

    // ---------------------------------------------------------------- views

    function getMandate(uint256 mandateId) external view returns (Mandate memory, Rule[] memory) {
        Book storage b = _bookOf(mandateId);
        return (b.mandate, _rulesIn(b));
    }

    function mandateIdOf(address account) external view returns (uint256 mandateId) {
        return _book(account).id;
    }

    /// @notice What a MandateAccount reads on every execute: one storage page.
    function rulesOf(address account) external view returns (bool exists, bool active, Rule[] memory rules) {
        Book storage b = _book(account);
        if (b.id == 0) return (false, false, rules);
        return (true, b.mandate.active, _rulesIn(b));
    }

    // ---------------------------------------------------------------- storage

    /// The account's Book lives at the first slot of the page `keccak256(account, BOOK_SEED) >> 7`: the low 7 bits are
    /// cleared so the Book (71 slots) never straddles two pages. Two accounts share a page only if their hashes agree
    /// in 249 bits, and the contract's declared variables (slots 0-5) sit on page 0.
    function _book(address account) internal pure returns (Book storage b) {
        uint256 slot = uint256(keccak256(abi.encode(account, BOOK_SEED))) & ~uint256(127);
        assembly ("memory-safe") {
            b.slot := slot
        }
    }

    function _bookOf(uint256 mandateId) internal view returns (Book storage b) {
        address account = _accountOf[mandateId];
        if (account == address(0)) revert UnknownMandate(mandateId);
        b = _book(account);
    }

    function _rulesIn(Book storage b) internal view returns (Rule[] memory rules) {
        rules = new Rule[](b.ruleCount);
        for (uint256 i; i < rules.length; ++i) {
            rules[i] = b.rules[i];
        }
    }
}
