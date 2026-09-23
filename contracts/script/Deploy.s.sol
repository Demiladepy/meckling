// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IPerplExchange} from "../src/venues/IPerplExchange.sol";
import {PerplAdapter} from "../src/venues/PerplAdapter.sol";
import {MandateRegistry} from "../src/MandateRegistry.sol";
import {MandateAccountFactory} from "../src/MandateAccountFactory.sol";
import {IMandateRules} from "../src/MandateAccount.sol";
import {OracleGuard, IAggregatorV3} from "../src/OracleGuard.sol";
import {BondVault} from "../src/BondVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVenue} from "../src/venues/IVenue.sol";

/// Deploys the whole stack and writes the addresses to deployments/<DEPLOYMENT_NAME or chainId>.json
/// (use DEPLOYMENT_NAME=local for an anvil fork).
///
///   forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    struct Market {
        uint256 perpId;
        address feed; // Chainlink aggregator, or zero where none exists
    }

    /// Resolved settings for one run: network defaults, with env overrides for a local fork.
    struct Config {
        address exchange;
        Market[] markets;
        uint32 maxAgeSec;
        uint16 tolBps;
        uint256 unwindSlippageBps;
        address arbiter;
    }

    function _config(address admin) internal view returns (Config memory c) {
        (address exchange, Market[] memory markets, uint32 defaultMaxAge, uint16 defaultTol) = _network(block.chainid);
        c.exchange = exchange;
        c.markets = markets;
        // Overridable for a local fork, where the forked Chainlink feed freezes while marks keep moving.
        c.maxAgeSec = uint32(vm.envOr("GUARD_MAX_AGE_SEC", uint256(defaultMaxAge)));
        c.tolBps = uint16(vm.envOr("GUARD_TOL_BPS", uint256(defaultTol)));
        c.unwindSlippageBps = vm.envOr("UNWIND_SLIPPAGE_BPS", uint256(300));
        // The arbiter resolves disputes; for the demo it is the deployer (PRD open question 4).
        c.arbiter = vm.envOr("ARBITER", admin);
    }

    function run() external {
        address admin = msg.sender;
        Config memory c = _config(admin);
        address exchange = c.exchange;

        vm.startBroadcast();
        PerplAdapter adapter = new PerplAdapter(IPerplExchange(exchange));
        for (uint256 i; i < c.markets.length; ++i) {
            adapter.syncMarket(c.markets[i].perpId);
        }
        MandateRegistry registry = new MandateRegistry(admin);
        MandateAccountFactory factory = new MandateAccountFactory(IMandateRules(address(registry)), adapter);
        registry.setFactory(address(factory));

        OracleGuard guard = new OracleGuard(IVenue(address(adapter)), admin);
        for (uint256 i; i < c.markets.length; ++i) {
            if (c.markets[i].feed != address(0)) {
                guard.setFeed(c.markets[i].perpId, IAggregatorV3(c.markets[i].feed), c.maxAgeSec, c.tolBps);
            }
        }
        BondVault vault = new BondVault(
            IERC20(adapter.collateralToken()), registry, IVenue(address(adapter)), guard, c.arbiter, c.unwindSlippageBps
        );
        registry.setBondVault(address(vault));
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "startBlock", block.number);
        vm.serializeAddress(o, "perplExchange", exchange);
        vm.serializeAddress(o, "collateralToken", adapter.collateralToken());
        vm.serializeAddress(o, "perplAdapter", address(adapter));
        vm.serializeAddress(o, "mandateRegistry", address(registry));
        vm.serializeAddress(o, "oracleGuard", address(guard));
        vm.serializeAddress(o, "bondVault", address(vault));
        string memory json = vm.serializeAddress(o, "mandateAccountFactory", address(factory));
        string memory name = vm.envOr("DEPLOYMENT_NAME", vm.toString(block.chainid));
        vm.writeJson(json, string.concat("deployments/", name, ".json"));
        console2.log(json);
    }

    /// Exchange, markets and oracle tolerances per network (docs/spikes.md S1 and S5).
    /// Mainnet feeds update within seconds, so the band is tight. Testnet feeds have a 24 h heartbeat and 0.5%
    /// deviation, so the band is wide and MON/SOL have no feed at all: those markets can never be flagged there.
    function _network(uint256 chainId)
        internal
        pure
        returns (address exchange, Market[] memory markets, uint32 maxAgeSec, uint16 tolBps)
    {
        if (chainId == 143) {
            markets = new Market[](4);
            markets[0] = Market(1, 0xc1d4C3331635184fA4C3c22fb92211B2Ac9E0546); // BTC / USD
            markets[1] = Market(20, 0x1B1414782B859871781bA3E4B0979b9ca57A0A04); // ETH / USD
            markets[2] = Market(10, 0xBcD78f76005B7515837af6b50c7C52BCf73822fb); // MON / USD
            markets[3] = Market(31, 0x16F8008c3e89f62e5e2b909Ce70999370D38F4F2); // SOL / USD
            return (0x34B6552d57a35a1D042CcAe1951BD1C370112a6F, markets, 3_900, 50);
        }
        if (chainId == 10143) {
            markets = new Market[](4);
            markets[0] = Market(16, 0x12C0F44368a02081ce58a936d1C1F606BB301715); // BTC / USD
            markets[1] = Market(32, 0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31); // ETH / USD
            markets[2] = Market(64, address(0)); // MON: no testnet feed
            markets[3] = Market(48, address(0)); // SOL: no testnet feed
            return (0x1964C32f0bE608E7D29302AFF5E61268E72080cc, markets, 90_000, 1_000);
        }
        revert("unsupported chain");
    }
}
