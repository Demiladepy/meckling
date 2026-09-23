// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {BondVault} from "./BondVault.sol";

/// @notice Chainlink CRE's KeystoneForwarder calls `onReport` on a consumer contract after verifying the workflow's
///         signatures (docs.chain.link/cre → building consumer contracts).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @notice Routes a CRE keeper workflow's decisions into BondVault (PRD 10.1, spike S4).
/// @dev This contract is deliberately trust-free. `flagBreach` and `slash` are permissionless and recompute
///      everything from on-chain state, so a forged report cannot invent a breach or misdirect a payout; the worst it
///      can do is call a function that reverts. The forwarder check is here so only CRE-verified reports spend gas.
contract CreKeeperReceiver is IReceiver {
    uint8 public constant ACTION_FLAG = 0;
    uint8 public constant ACTION_SLASH = 1;

    address public immutable forwarder;
    BondVault public immutable vault;

    event ReportHandled(uint8 action, address indexed account, uint256 value, bool ok);

    error NotForwarder();
    error UnknownAction(uint8 action);

    constructor(address forwarder_, BondVault vault_) {
        forwarder = forwarder_;
        vault = vault_;
    }

    /// @param report abi.encode(uint8 action, address account, uint256 value)
    ///        action 0: flag market rule `value` on `account`; action 1: slash breach id `value`.
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder();
        (uint8 action, address account, uint256 value) = abi.decode(report, (uint8, address, uint256));

        if (action == ACTION_FLAG) {
            // A losing race (another keeper flagged first) must not fail the whole report.
            try vault.flagBreach(account, value) {
                emit ReportHandled(action, account, value, true);
            } catch {
                emit ReportHandled(action, account, value, false);
            }
        } else if (action == ACTION_SLASH) {
            try vault.slash(value) {
                emit ReportHandled(action, account, value, true);
            } catch {
                emit ReportHandled(action, account, value, false);
            }
        } else {
            revert UnknownAction(action);
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
