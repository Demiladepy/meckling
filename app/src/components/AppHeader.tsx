"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useMera } from "@/lib/mera";
import { shortAddr, useConfig } from "@/lib/client";
import s from "./AppHeader.module.css";

const NAV = [
  { href: "/agents", label: "Agents" },
  { href: "/mandates/new", label: "Back an agent" },
  { href: "/trade", label: "Trade" },
];

/** Quiet chrome: the brand, three destinations, and the passkey account. The current page carries the blue mark. */
export function AppHeader() {
  const mera = useMera();
  const path = usePathname();
  const [copied, setCopied] = useState(false);
  const cfg = useConfig();
  const [drip, setDrip] = useState<{ state: "idle" | "busy" | "done" | "error"; text?: string }>({ state: "idle" });

  // Judges arrive with an empty passkey account; one tap gets test MON for gas and AUSD to trade (testnet only).
  async function getTestFunds(address: string) {
    setDrip({ state: "busy" });
    try {
      const res = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
      const body = (await res.json()) as { error?: string; message?: string; mon?: { amount: string } | null; ausd?: { amount: number } | null };
      if (!res.ok) return setDrip({ state: "error", text: body.error ?? "The faucet failed." });
      const parts = [body.mon && `${body.mon.amount} MON`, body.ausd && `${body.ausd.amount} AUSD`].filter(Boolean);
      setDrip({ state: "done", text: parts.length ? `Sent ${parts.join(" and ")}` : body.message });
    } catch {
      setDrip({ state: "error", text: "The faucet is unreachable. Try again in a moment." });
    }
  }

  // Clicking the address copies it (you need it to send test MON); signing out is its own, separate button.
  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be refused (insecure origin, permissions); the full address is still in the title tooltip.
    }
  }
  return (
    <header className={s.header}>
      <div className={s.inner}>
        <Link href="/" className={s.brand} aria-label="Mandate home">
          <span className={s.mark} aria-hidden />
          Mandate
        </Link>
        <nav className={s.nav} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={s.link} aria-current={path?.startsWith(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        {mera.account ? (
          <div className={s.accountGroup}>
            {cfg?.faucet && drip.state !== "done" && (
              <button
                type="button"
                className={s.signout}
                onClick={() => void getTestFunds(mera.account!.address)}
                disabled={drip.state === "busy"}
                title={drip.state === "error" ? drip.text : "Test MON for gas and AUSD to trade, on Monad testnet"}
              >
                {drip.state === "busy" ? "Sending…" : drip.state === "error" ? "Faucet unavailable" : "Get test funds"}
              </button>
            )}
            {drip.state === "done" && <span className={s.dripNote}>{drip.text}</span>}
            <button
              type="button"
              className={s.account}
              onClick={() => void copyAddress(mera.account!.address)}
              title={mera.account.address}
              aria-label={`Copy address ${mera.account.address}`}
            >
              <span className={s.dot} aria-hidden />
              <span className="onchain">{copied ? "Copied" : shortAddr(mera.account.address)}</span>
            </button>
            <button type="button" className={s.signout} onClick={mera.signOut}>
              Sign out
            </button>
          </div>
        ) : (
          <button type="button" className={s.signin} onClick={() => void mera.signIn()} disabled={mera.busy}>
            {mera.busy ? "Waiting for passkey" : mera.hasPasskey ? "Sign in" : "Create account"}
          </button>
        )}
      </div>
    </header>
  );
}
