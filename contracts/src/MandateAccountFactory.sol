// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateAccount, IMandateRules} from "./MandateAccount.sol";
import {IVenue} from "./venues/IVenue.sol";

/// @notice Deploys MandateAccounts with CREATE2 so their addresses are known before funding. The caller becomes the
///         account owner. The venue is fixed per factory.
contract MandateAccountFactory {
    IMandateRules public immutable registry;
    IVenue public immutable venue;

    mapping(address account => bool) public isAccount;

    event AccountCreated(address indexed account, address indexed owner, address indexed operator, bytes32 salt);

    constructor(IMandateRules registry_, IVenue venue_) {
        registry = registry_;
        venue = venue_;
    }

    function createAccount(address operator, bytes32 salt) external returns (MandateAccount account) {
        account = new MandateAccount{salt: _salt(msg.sender, operator, salt)}(msg.sender, operator, registry, venue);
        isAccount[address(account)] = true;
        emit AccountCreated(address(account), msg.sender, operator, salt);
    }

    function predictAddress(address owner, address operator, bytes32 salt) external view returns (address) {
        bytes memory init =
            abi.encodePacked(type(MandateAccount).creationCode, abi.encode(owner, operator, registry, venue));
        bytes32 h =
            keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(owner, operator, salt), keccak256(init)));
        return address(uint160(uint256(h)));
    }

    function _salt(address owner, address operator, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, operator, salt));
    }
}
