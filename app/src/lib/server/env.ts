import "server-only";
import { join } from "node:path";
import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { loadNetwork } from "@mandate/common/node";
import type { NetworkKey } from "@mandate/common";

export const NETWORK = (process.env.NETWORK as NetworkKey) || "local";
export const net = loadNetwork(NETWORK);

/** Repo-level data/ shared with the agent: agent-logs/ and reports/. */
export const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "..", "data");

export const pub = createPublicClient({ chain: net.chain, transport: http(net.rpcUrl) }) as PublicClient;

/** The agent this deployment offers to backers: its operator and session key addresses. */
export const AGENT = {
  operator: (process.env.AGENT_OPERATOR_ADDRESS || "0x90F79bf6EB2c4f870365E785982E1f101E93b906") as Address,
  sessionKey: (process.env.AGENT_SESSION_ADDRESS || "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC") as Address,
};

export function deployment() {
  if (!net.deployment) throw new Error(`No Mandate deployment for ${NETWORK}`);
  return net.deployment;
}
