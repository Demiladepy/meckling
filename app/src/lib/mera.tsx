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
import { getAddress, type Account, type EIP1193Provider, type LocalAccount } from "viem";

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

/** Monad testnet, as a browser wallet needs to be told about it (EIP-3085). */
const MONAD_TESTNET = {
  chainId: "0x279f", // 10143
  chainName: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: ["https://testnet-rpc.monad.xyz"],
};

const injected = () => (globalThis as { ethereum?: EIP1193Provider }).ethereum;

interface MeraState {
  /** The signed-in account: a passkey signing session (the main path) or a browser wallet. */
  account?: Account;
  /** How the person signed in. Private reasoning (D13) needs the passkey. */
  kind?: "passkey" | "wallet";
  hasPasskey: boolean;
  /** A browser wallet (MetaMask, Rabby and others) is present on this device. */
  hasWallet: boolean;
  busy: boolean;
  error?: string;
  signIn: () => Promise<LocalAccount | undefined>;
  /** The alternative: sign in with a browser wallet, switched to Monad testnet. */
  connectWallet: () => Promise<Account | undefined>;
  signOut: () => void;
  /**
   * Evaluates the same passkey under another PRF salt: an isolated namespace for non-wallet keys (D13). Returns the
   * 32-byte PRF output, deterministic for (passkey, salt) on any device. Shows one passkey prompt.
   */
  prfFor: (salt: Uint8Array) => Promise<Uint8Array>;
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
  const [account, setAccount] = useState<Account>();
  const [kind, setKind] = useState<"passkey" | "wallet">();
  const [hasPasskey, setHasPasskey] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const session = useRef<Secp256k1SigningSession | null>(null);

  useEffect(() => {
    setHasPasskey(Boolean(loadCredential()));
    setHasWallet(Boolean(injected()));
  }, []);

  const signOut = useCallback(() => {
    session.current?.end();
    session.current = null;
    setAccount(undefined);
    setKind(undefined);
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
      setKind("passkey");
      return acct;
    } catch (err) {
      setError(friendly(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const connectWallet = useCallback(async () => {
    const eth = injected();
    setError(undefined);
    if (!eth) {
      setError("No browser wallet found on this device. Install MetaMask or Rabby, or use a passkey.");
      return undefined;
    }
    setBusy(true);
    try {
      const [address] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!address) throw new Error("The wallet shared no account.");
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MONAD_TESTNET.chainId }] });
      } catch (e) {
        // 4902: the wallet doesn't know Monad testnet yet, so add it (which also switches to it).
        if ((e as { code?: number }).code !== 4902) throw e;
        await eth.request({ method: "wallet_addEthereumChain", params: [MONAD_TESTNET] });
      }
      session.current?.end();
      session.current = null;
      const acct: Account = { address: getAddress(address), type: "json-rpc" };
      setAccount(acct);
      setKind("wallet");
      return acct;
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet didn't connect.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const prfFor = useCallback(async (salt: Uint8Array) => {
    const { prfOutput } = await getPasskeyPrfOutput({ rpId: location.hostname, credential: loadCredential(), prfSalt: salt });
    return prfOutput;
  }, []);

  const value = useMemo(
    () => ({ account, kind, hasPasskey, hasWallet, busy, error, signIn, connectWallet, signOut, prfFor }),
    [account, kind, hasPasskey, hasWallet, busy, error, signIn, connectWallet, signOut, prfFor],
  );
  return <MeraContext.Provider value={value}>{children}</MeraContext.Provider>;
}

export function useMera(): MeraState {
  const ctx = useContext(MeraContext);
  if (!ctx) throw new Error("useMera outside MeraProvider");
  return ctx;
}
