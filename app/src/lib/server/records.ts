import "server-only";
import { Redis } from "@upstash/redis";
import type { Address } from "viem";

// Shared with services/agent/src/records.ts: the agent writes these keys, the app reads them.
const logKey = (account: Address) => `agent:log:${account.toLowerCase()}`;
const memoryKeyKey = (account: Address) => `memory:pubkey:${account.toLowerCase()}`;

const redis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : undefined;
// Reports are stored as raw text: their keccak256 is the on-chain reportHash, so the bytes must come back unchanged
// (the default client would parse the JSON and re-serialise it).
const rawRedis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv({ automaticDeserialization: false }) : undefined;
const reportKey = (hash: string) => `report:${hash.toLowerCase()}`;

/** The agent's latest records as published to Upstash, oldest first; undefined when there is no store or none yet. */
export async function publishedLog(account: Address, limit = 100): Promise<unknown[] | undefined> {
  if (!redis) return undefined;
  const rows = await redis.lrange<unknown>(logKey(account), -limit, -1);
  if (!rows.length) return undefined;
  // @upstash/redis parses JSON values; anything still a string is parsed here.
  return rows.map((r) => (typeof r === "string" ? (JSON.parse(r) as unknown) : r));
}

/** The backer's registered memory public key for this agent (D13), as 0x-hex, if any. */
export async function memoryPublicKey(account: Address): Promise<string | undefined> {
  if (!redis) return undefined;
  return (await redis.get<string>(memoryKeyKey(account))) ?? undefined;
}

export async function setMemoryPublicKey(account: Address, publicKey: string): Promise<void> {
  if (!redis) throw new Error("No record store configured");
  await redis.set(memoryKeyKey(account), publicKey);
}

/** Keeps an underwriting report for good, so anyone can fetch it and check it against the mandate's reportHash. */
export async function saveReport(hash: string, body: string): Promise<boolean> {
  if (!rawRedis) return false;
  await rawRedis.set(reportKey(hash), body);
  return true;
}

export async function storedReport(hash: string): Promise<string | undefined> {
  if (!rawRedis) return undefined;
  return (await rawRedis.get<string>(reportKey(hash))) ?? undefined;
}

export const hasRecordStore = () => Boolean(redis);
