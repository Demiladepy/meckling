"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMera } from "@/lib/mera";
import { shortAddr } from "@/lib/client";
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
          <button type="button" className={s.account} onClick={mera.signOut} title="Sign out">
            <span className={s.dot} aria-hidden />
            <span className="onchain">{shortAddr(mera.account.address)}</span>
          </button>
        ) : (
          <button type="button" className={s.signin} onClick={() => void mera.signIn()} disabled={mera.busy}>
            {mera.busy ? "Waiting for passkey" : mera.hasPasskey ? "Sign in" : "Create account"}
          </button>
        )}
      </div>
    </header>
  );
}
