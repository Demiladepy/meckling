// Where the agent's records go besides the local log: Upstash Redis, so the public app can show live reasoning
// (the app runs on Vercel and never sees this machine's disk). Keys are shared with app/src/lib/server/records.ts.
import { Redis } from "@upstash/redis";
import { hexToBytes, isHex, type Address } from "viem";

export const logKey = (account: Address) => `agent:log:${account.toLowerCase()}`;
/** The backer's memory public key for this agent (D13), registered from the app after a signed check. */
export const memoryKeyKey = (account: Address) => `memory:pubkey:${account.toLowerCase()}`;
/** The public screen shows the latest records; older ones stay in the local log. */
const KEEP = 500;
/** How often to re-read the backer's memory key, so turning privacy on takes effect without a restart. */
const MEMORY_KEY_TTL_MS = 60_000;

export interface RecordSink {
  publish(record: object): Promise<void>;
  /** The backer's X25519 memory public key, if they made this agent's reasoning private. */
  memoryKey(): Promise<Uint8Array | undefined>;
}

export function recordSink(env: NodeJS.ProcessEnv, account: Address): RecordSink | undefined {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  const redis = new Redis({ url, token });
  let cached: { at: number; key: Uint8Array | undefined } | undefined;

  return {
    async publish(record) {
      await redis.rpush(logKey(account), JSON.stringify(record));
      await redis.ltrim(logKey(account), -KEEP, -1);
    },
    async memoryKey() {
      if (cached && Date.now() - cached.at < MEMORY_KEY_TTL_MS) return cached.key;
      const hex = await redis.get<string>(memoryKeyKey(account));
      const key = hex && isHex(hex) && hex.length === 66 ? hexToBytes(hex) : undefined;
      cached = { at: Date.now(), key };
      return key;
    },
  };
}
