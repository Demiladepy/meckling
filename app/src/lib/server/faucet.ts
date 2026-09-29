import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { parseEther } from "viem";
import { NETWORK } from "@/lib/server/env";

/** How much one drip sends, and the balances below which a wallet counts as short. */
export const MON_DRIP = parseEther(process.env.FAUCET_MON || "0.25");
export const MON_LOW = parseEther("0.1");
export const AUSD_DRIP = BigInt(Math.round(Number(process.env.FAUCET_AUSD || "150") * 1e6));
/** Perpl's minimum to open an account on testnet (getMinAccountOpenCNS, docs/spikes.md S1). */
export const AUSD_LOW = 100_000_000n;

const redis = process.env.UPSTASH_REDIS_REST_URL ? Redis.fromEnv() : undefined;
/** Limits live in Upstash so they hold across serverless instances. */
export const perAddress = redis && new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(1, "1 d"), prefix: "faucet:addr" });
export const perIp = redis && new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(3, "1 d"), prefix: "faucet:ip" });

/** Whether this deployment can drip, so the UI knows to offer the button. */
export function faucetAvailable(): boolean {
  return NETWORK === "testnet" && Boolean(process.env.FAUCET_PRIVATE_KEY) && Boolean(redis);
}
