// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IPerplExchange} from "../src/venues/IPerplExchange.sol";
import {PerplAdapter} from "../src/venues/PerplAdapter.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {MandateAccountFactory} from "../src/MandateAccountFactory.sol";
import {IMandateRules} from "../src/MandateAccount.sol";

/// Deploys PerplAdapter, MandateRegistry and MandateAccountFactory, syncs the network's markets, and writes the
/// addresses to deployments/<DEPLOYMENT_NAME or chainId>.json (use DEPLOYMENT_NAME=local for an anvil fork).
///
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        (address exchange, uint256[4] memory perps) = _network(block.chainid);

        vm.startBroadcast();
        PerplAdapter adapter = new PerplAdapter(IPerplExchange(exchange));
        for (uint256 i; i < perps.length; ++i) {
            adapter.syncMarket(perps[i]);
        }
        MandateRegistry registry = new MandateRegistry(msg.sender);
        MandateAccountFactory factory = new MandateAccountFactory(IMandateRules(address(registry)), adapter);
        registry.setFactory(address(factory));
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", block.number);
        vm.serializeAddress(o, "perplExchange", exchange);
        vm.serializeAddress(o, "collateralToken", adapter.collateralToken());
        vm.serializeAddress(o, "perplAdapter", address(adapter));
        vm.serializeAddress(o, "mandateRegistry", address(registry));
        string memory json = vm.serializeAddress(o, "mandateAccountFactory", address(factory));
        string memory name = vm.envOr("DEPLOYMENT_NAME", vm.toString(block.chainid));
        vm.writeJson(json, string.concat("deployments/", name, ".json"));
        console2.log(json);
    }

    /// Perpl exchange and market ids per network (docs/spikes.md S1): BTC, ETH, MON, SOL.
    function _network(uint256 chainId) internal pure returns (address exchange, uint256[4] memory perps) {
        if (chainId == 143) return (0x34B6552d57a35a1D042CcAe1951BD1C370112a6F, [uint256(1), 20, 10, 31]);
        if (chainId == 10143) return (0x1964C32f0bE608E7D29302AFF5E61268E72080cc, [uint256(16), 32, 64, 48]);
        revert("unsupported chain");
    }
}
