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
    mapping(uint256 mandateId => Mandate) internal _mandates;
    mapping(uint256 mandateId => Rule[]) internal _rules;
    mapping(address account => uint256 mandateId) public mandateIdOf;

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
        if (mandateIdOf[account] != 0) revert MandateExists(account);
        if (rules.length == 0 || rules.length > RuleEngine.MAX_RULES) revert BadRuleCount();

        mandateId = ++mandateCount;
        mandateIdOf[account] = mandateId;
        _mandates[mandateId] = Mandate({
            account: account,
            backer: msg.sender,
            operator: IMandateAccountView(account).operator(),
            reportHash: reportHash,
            createdAtBlock: uint64(block.number),
            disputeWindowBlocks: disputeWindowBlocks,
            active: true
        });
        Rule[] storage stored = _rules[mandateId];
        for (uint256 i; i < rules.length; ++i) {
            if (!RuleEngine.validate(rules[i])) revert InvalidRule(i);
            stored.push(rules[i]);
            emit RuleSet(mandateId, i, rules[i]);
        }
        emit MandateCreated(mandateId, account, msg.sender, reportHash);
    }

    /// @notice Replaces rule `ruleIndex` with a stricter version of the same kind. Backer only.
    function tightenRule(uint256 mandateId, uint256 ruleIndex, Rule calldata newRule) external {
        Mandate storage m = _mandate(mandateId);
        if (msg.sender != m.backer) revert NotBacker();
        if (!m.active) revert Inactive();
        Rule[] storage rules = _rules[mandateId];
        if (ruleIndex >= rules.length || !RuleEngine.isTightening(rules[ruleIndex], newRule)) {
            revert NotTightening(ruleIndex);
        }
        rules[ruleIndex] = newRule;
        emit RuleSet(mandateId, ruleIndex, newRule);
        emit RuleTightened(mandateId, ruleIndex);
    }

    /// @notice Ends the mandate. The account moves to close-only mode permanently. Backer only.
    function deactivate(uint256 mandateId) external {
        Mandate storage m = _mandate(mandateId);
        if (msg.sender != m.backer) revert NotBacker();
        if (!m.active) revert Inactive();
        m.active = false;
        emit MandateDeactivated(mandateId, m.account);
    }

    // ---------------------------------------------------------------- views

    function getMandate(uint256 mandateId) external view returns (Mandate memory, Rule[] memory) {
        return (_mandate(mandateId), _rules[mandateId]);
    }

    /// @notice What a MandateAccount reads on every execute.
    function rulesOf(address account) external view returns (bool exists, bool active, Rule[] memory rules) {
        uint256 id = mandateIdOf[account];
        if (id == 0) return (false, false, rules);
        return (true, _mandates[id].active, _rules[id]);
    }

    function _mandate(uint256 mandateId) internal view returns (Mandate storage m) {
        m = _mandates[mandateId];
        if (m.account == address(0)) revert UnknownMandate(mandateId);
    }
}
