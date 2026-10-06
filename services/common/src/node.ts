// Server-only helpers (read files). Import from "@mandate/common/node".
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getNetwork, type Deployment, type NetworkConfig, type NetworkKey } from "./networks.ts";

export const DEPLOYMENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../contracts/deployments");

const FILE: Record<NetworkKey, string> = { mainnet: "143", testnet: "10143", local: "local" };

/**
 * Testnet addresses verified on-chain (redeployed Oct 7, 2026). Bundled here so Vercel with
 * Root Directory = `app/` still has a deployment without reading contracts/.
 */
const TESTNET_DEPLOYMENT: Deployment = {
  bondVault: "0x8CA4854e7fB030ec9168f197450E16A305c2600B",
  chainId: 10143,
  collateralToken: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  mandateAccountFactory: "0xA8A3dB9d38187dA5Df7d79E45234d3322D9F4581",
  mandateRegistry: "0x9E1C7e886Da953B96D091D1b8324c69F0260bc68",
  oracleGuard: "0x7642e42A07074f70cB45aBC713D26D9c96C608d9",
  perplAdapter: "0x47c0ac6203E321d2Bc797fB97298900f584D3716",
  perplExchange: "0x1964C32f0bE608E7D29302AFF5E61268E72080cc",
  startBlock: 68815384,
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
