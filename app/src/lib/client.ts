"use client";

import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type LocalAccount, type PublicClient } from "viem";
import type { Deployment, MarketInfo, NetworkKey } from "@mandate/common";

export interface AppConfig {
  network: NetworkKey;
  chainId: number;
  rpcUrl: string;
  markets: MarketInfo[];
  deployment: Deployment | null;
  agent: { operator: Address; sessionKey: Address };
  devFaucet: boolean;
  /** Testnet judge faucet is available (api/faucet). */
  faucet?: boolean;
  nansenLive: boolean;
}

export function useConfig(): AppConfig | undefined {
  const [cfg, setCfg] = useState<AppConfig>();
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(setCfg)
      .catch(() => undefined);
  }, []);
  return cfg;
}

export function chainOf(cfg: AppConfig) {
  return defineChain({
    id: cfg.chainId,
    name: cfg.network === "testnet" ? "Monad Testnet" : cfg.network === "local" ? "Monad (local fork)" : "Monad",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

export function clients(cfg: AppConfig, account: LocalAccount) {
  const chain = chainOf(cfg);
  const transport = http(cfg.rpcUrl, { batch: { wait: 20 }, retryCount: 3, retryDelay: 250 });
  return {
    pub: createPublicClient({ chain, transport }) as PublicClient,
    wallet: createWalletClient({ chain, transport, account }),
  };
}

/** Polls a JSON endpoint. Keeps the last good value on transient errors. */
export function usePoll<T>(url: string | undefined, ms: number): T | undefined {
  const [data, setData] = useState<T>();
  useEffect(() => {
    if (!url) return;
    let live = true;
    const tick = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok && live) setData((await r.json()) as T);
      } catch {
        // keep the last value
      }
    };
    void tick();
    const id = setInterval(tick, ms);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [url, ms]);
  return data;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const formatBlock = (b: string | bigint | number) => Number(b).toLocaleString("en-US");
export const usd = (n: number, max = 2) => `$${n.toLocaleString("en-US", { maximumFractionDigits: max })}`;
