// Per-network configuration. Market ids and decimals were read from each Perpl exchange (docs/spikes.md S1),
// Chainlink feeds from the Chainlink directory (S5). Testnet and mainnet market ids differ.
import { defineChain, type Address, type Chain } from "viem";
import { monad, monadTestnet } from "viem/chains";

export type MarketSymbol = "BTC" | "ETH" | "MON" | "SOL";
export type NetworkKey = "mainnet" | "testnet" | "local";

export interface MarketInfo {
  symbol: MarketSymbol;
  perpId: number;
  priceDecimals: number;
  lotDecimals: number;
  /** Chainlink Data Feed (8 decimals) used by OracleGuard; absent where none exists. */
  chainlinkFeed?: Address;
}

export interface Deployment {
  chainId: number;
  startBlock: number;
  perplExchange: Address;
  collateralToken: Address;
  perplAdapter: Address;
  mandateRegistry: Address;
  mandateAccountFactory: Address;
  oracleGuard: Address;
  bondVault: Address;
}

export interface NetworkConfig {
  key: NetworkKey;
  chain: Chain;
  rpcUrl: string;
  perplExchange: Address;
  perplApi: string;
  collateralDecimals: 6;
  markets: MarketInfo[];
  deployment?: Deployment;
}

const MAINNET_MARKETS: MarketInfo[] = [
  { symbol: "BTC", perpId: 1, priceDecimals: 1, lotDecimals: 5, chainlinkFeed: "0xc1d4C3331635184fA4C3c22fb92211B2Ac9E0546" },
  { symbol: "ETH", perpId: 20, priceDecimals: 2, lotDecimals: 3, chainlinkFeed: "0x1B1414782B859871781bA3E4B0979b9ca57A0A04" },
  { symbol: "MON", perpId: 10, priceDecimals: 6, lotDecimals: 0, chainlinkFeed: "0xBcD78f76005B7515837af6b50c7C52BCf73822fb" },
  { symbol: "SOL", perpId: 31, priceDecimals: 3, lotDecimals: 3, chainlinkFeed: "0x16F8008c3e89f62e5e2b909Ce70999370D38F4F2" },
];

const TESTNET_MARKETS: MarketInfo[] = [
  { symbol: "BTC", perpId: 16, priceDecimals: 1, lotDecimals: 5, chainlinkFeed: "0x12C0F44368a02081ce58a936d1C1F606BB301715" },
  { symbol: "ETH", perpId: 32, priceDecimals: 2, lotDecimals: 3, chainlinkFeed: "0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31" },
  { symbol: "MON", perpId: 64, priceDecimals: 5, lotDecimals: 0 },
  { symbol: "SOL", perpId: 48, priceDecimals: 2, lotDecimals: 3 },
];

/** A local anvil fork of Monad mainnet (chain id 143, served on localhost). */
export const monadLocalFork = defineChain({
  ...monad,
  name: "Monad (local fork)",
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

/** Browser-safe. Pass the deployment explicitly; on the server use `loadNetwork` from `@mandate/common/node`. */
export function getNetwork(
  key: NetworkKey,
  env: Record<string, string | undefined> = {},
  deployment?: Deployment,
): NetworkConfig {
  switch (key) {
    case "mainnet":
      return {
        key,
        chain: monad,
        rpcUrl: env.MONAD_RPC_URL || "https://rpc.monad.xyz",
        perplExchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
        perplApi: "https://app.perpl.xyz/api",
        collateralDecimals: 6,
        markets: MAINNET_MARKETS,
        deployment,
      };
    case "testnet":
      return {
        key,
        chain: monadTestnet,
        rpcUrl: env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz",
        perplExchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
        perplApi: "https://testnet.perpl.xyz/api",
        collateralDecimals: 6,
        markets: TESTNET_MARKETS,
        deployment,
      };
    case "local":
      return {
        key,
        chain: monadLocalFork,
        rpcUrl: env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
        perplExchange: "0x34B6552d57a35a1D042CcAe1951BD1C370112a6F",
        perplApi: "https://app.perpl.xyz/api",
        collateralDecimals: 6,
        markets: MAINNET_MARKETS,
        deployment,
      };
  }
}

export function marketBySymbol(net: NetworkConfig, symbol: MarketSymbol): MarketInfo {
  const m = net.markets.find((x) => x.symbol === symbol);
  if (!m) throw new Error(`Market ${symbol} not configured on ${net.key}`);
  return m;
}

export function marketById(net: NetworkConfig, perpId: number): MarketInfo | undefined {
  return net.markets.find((x) => x.perpId === perpId);
}
