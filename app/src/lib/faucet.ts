"use client";

import { useState } from "react";

export type Drip = { state: "idle" | "busy" | "done" | "error"; text?: string };

/** The testnet judge faucet: one tap sends test MON for gas and AUSD to trade (api/faucet, rate-limited). */
export function useFaucet() {
  const [drip, setDrip] = useState<Drip>({ state: "idle" });

  async function getTestFunds(address: string) {
    setDrip({ state: "busy" });
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const body = (await res.json()) as { error?: string; message?: string; mon?: { amount: string } | null; ausd?: { amount: number } | null };
      if (!res.ok) return setDrip({ state: "error", text: body.error ?? "The faucet failed." });
      const parts = [body.mon && `${body.mon.amount} MON`, body.ausd && `${body.ausd.amount} AUSD`].filter(Boolean);
      setDrip({ state: "done", text: parts.length ? `Sent ${parts.join(" and ")}` : body.message });
    } catch {
      setDrip({ state: "error", text: "The faucet is unreachable. Try again in a moment." });
    }
  }

  return { drip, getTestFunds };
}
