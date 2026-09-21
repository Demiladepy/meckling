"use client";

import Link from "next/link";
import { useMera } from "@/lib/mera";
import { shortAddr } from "@/lib/client";
import s from "./AppHeader.module.css";

/** Near-invisible chrome: the product name and the passkey account, nothing else. */
export function AppHeader() {
  const mera = useMera();
  return (
    <header className={s.header}>
      <Link href="/" className={s.brand}>
        Mandate
      </Link>
      {mera.account ? (
        <button type="button" className={s.account} onClick={mera.signOut} title="Sign out">
          <span className="onchain">{shortAddr(mera.account.address)}</span>
        </button>
      ) : (
        <button type="button" className={s.signin} onClick={() => void mera.signIn()} disabled={mera.busy}>
          {mera.hasPasskey ? "Sign in with passkey" : "Create passkey account"}
        </button>
      )}
    </header>
  );
}
