"use client";

// Mera passkey accounts (docs/spikes.md S3): the passkey's PRF output derives an EVM key (BIP-39/44), held in a
// signing session only while the app is open. No seed phrase, no extension, no custody backend.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  getPasskeyPrfOutput,
  isMeraError,
  type PasskeyCredentialMetadata,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import type { LocalAccount } from "viem";

const STORAGE_KEY = "mandate.passkey";

function deriveEvmKey(prfOutput: Uint8Array, index = 0): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${index}`);
  if (!node.privateKey) throw new Error("Passkey derivation produced no key");
  return node.privateKey;
}

function loadCredential(): PasskeyCredentialMetadata | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PasskeyCredentialMetadata) : undefined;
  } catch {
    return undefined;
  }
}

function saveCredential(c: PasskeyCredentialMetadata) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ credentialId: c.credentialId, transports: c.transports }));
  } catch {
    // Private windows can refuse storage; the passkey still works via discoverable credentials.
  }
}

interface MeraState {
  account?: LocalAccount;
  hasPasskey: boolean;
  busy: boolean;
  error?: string;
  signIn: () => Promise<LocalAccount | undefined>;
  signOut: () => void;
}

const MeraContext = createContext<MeraState | null>(null);

function friendly(err: unknown): string {
  if (isMeraError(err)) {
    if (err.code === "PRF_UNAVAILABLE") {
      return "This passkey can't derive an account. Use iCloud Keychain, Google Password Manager or 1Password.";
    }
    if (err.code === "PASSKEY_OPERATION_FAILED") return "Passkey sign-in was cancelled or isn't available here.";
  }
  return err instanceof Error ? err.message : "Sign-in failed.";
}

export function MeraProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<LocalAccount>();
  const [hasPasskey, setHasPasskey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const session = useRef<Secp256k1SigningSession | null>(null);

  useEffect(() => setHasPasskey(Boolean(loadCredential())), []);

  const signOut = useCallback(() => {
    session.current?.end();
    session.current = null;
    setAccount(undefined);
  }, []);

  // End the session when the page is closed, so the key never outlives the tab.
  useEffect(() => {
    const end = () => session.current?.end();
    window.addEventListener("pagehide", end);
    return () => window.removeEventListener("pagehide", end);
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const stored = loadCredential();
      let prfOutput: Uint8Array;
      if (stored) {
        ({ prfOutput } = await getPasskeyPrfOutput({ rpId: location.hostname, credential: stored }));
      } else {
        const created = await createPasskeyWithPrfOutput({
          rp: { id: location.hostname, name: "Mandate" },
          user: { name: "Mandate account", displayName: "Mandate account" },
        });
        saveCredential(created);
        setHasPasskey(true);
        prfOutput = created.prfOutput;
      }
      session.current?.end();
      session.current = createSecp256k1SigningSession({ privateKey: deriveEvmKey(prfOutput) });
      const acct = toViemAccount(session.current);
      setAccount(acct);
      return acct;
    } catch (err) {
      setError(friendly(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const value = useMemo(() => ({ account, hasPasskey, busy, error, signIn, signOut }), [account, hasPasskey, busy, error, signIn, signOut]);
  return <MeraContext.Provider value={value}>{children}</MeraContext.Provider>;
}

export function useMera(): MeraState {
  const ctx = useContext(MeraContext);
  if (!ctx) throw new Error("useMera outside MeraProvider");
  return ctx;
}
