"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useMera } from "@/lib/mera";
import { shortAddr, useConfig } from "@/lib/client";
import { useFaucet } from "@/lib/faucet";
import s from "./AppHeader.module.css";

const NAV = [
  { href: "/agents", label: "Agents" },
  { href: "/mandates/new", label: "Back an agent" },
  { href: "/trade", label: "Trade" },
  { href: "/manifesto", label: "Manifesto" },
];

/** Quiet chrome: the brand, three destinations, and the passkey account. The current page carries the blue mark. */
export function AppHeader() {
  const mera = useMera();
  const path = usePathname();
  const [copied, setCopied] = useState(false);
  const cfg = useConfig();
  const { drip, getTestFunds } = useFaucet();

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
        <Link href="/" className={s.brand} aria-label="Meckling home">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 28px static brand mark needs no optimiser */}
          <img className={s.mark} src="/brand/mandate-mark-white.png" alt="" width={28} height={28} />
          Meckling
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
