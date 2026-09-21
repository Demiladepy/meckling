// Server-only helpers (read files). Import from "@mandate/common/node".
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getNetwork, type Deployment, type NetworkConfig, type NetworkKey } from "./networks.ts";

export const DEPLOYMENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../contracts/deployments");

const FILE: Record<NetworkKey, string> = { mainnet: "143", testnet: "10143", local: "local" };

export function loadDeployment(key: NetworkKey): Deployment | undefined {
  const file = join(DEPLOYMENTS_DIR, `${FILE[key]}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Deployment) : undefined;
}

/** Network config with its deployment loaded from contracts/deployments. */
export function loadNetwork(key: NetworkKey, env: Record<string, string | undefined> = process.env): NetworkConfig {
  return getNetwork(key, env, loadDeployment(key));
}
