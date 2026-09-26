// Server-only helpers (read files). Import from "@mandate/common/node".
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getNetwork, type Deployment, type NetworkConfig, type NetworkKey } from "./networks.ts";

export const DEPLOYMENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../contracts/deployments");

const FILE: Record<NetworkKey, string> = { mainnet: "143", testnet: "10143", local: "local" };

/**
 * Testnet addresses verified on-chain (docs/handoff.md). Bundled here so Vercel with
 * Root Directory = `app/` still has a deployment without reading contracts/.
 */
const TESTNET_DEPLOYMENT: Deployment = {
  bondVault: "0xe6FB91056f899656d3700DbDb7BcE5680984686f",
  chainId: 10143,
  collateralToken: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  mandateAccountFactory: "0x8F721E6B1367d471cFbA5fBdBbD714f208eB4F34",
  mandateRegistry: "0x9e6F25f2291AFD83d56fFf502670Dcc781E2A133",
  oracleGuard: "0xC395AFc52F37133091ec70907d859Fb0aeeDfAA2",
  perplAdapter: "0xE8F999dECEB04FC84a9da540b577cB4C66ec69bE",
  perplExchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
  startBlock: 64968808,
};

export function loadDeployment(key: NetworkKey): Deployment | undefined {
  if (key === "testnet") return TESTNET_DEPLOYMENT;
  const file = join(DEPLOYMENTS_DIR, `${FILE[key]}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Deployment;
  const alt = join(process.cwd(), "..", "contracts", "deployments", `${FILE[key]}.json`);
  if (existsSync(alt)) return JSON.parse(readFileSync(alt, "utf8")) as Deployment;
  return undefined;
}

/** Network config with its deployment loaded from contracts/deployments. */
export function loadNetwork(key: NetworkKey, env: Record<string, string | undefined> = process.env): NetworkConfig {
  return getNetwork(key, env, loadDeployment(key));
}
