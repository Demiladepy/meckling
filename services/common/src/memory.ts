// Agent memory encrypted to the backer's passkey (docs/decisions.md D13).
//
// An agent's reasoning reveals the operator's strategy and the backer's positions, so it should be readable by the
// backer and nobody else — on any device, with nothing stored anywhere.
//
//   1. Namespace. The backer's passkey is evaluated with a PRF salt unique to this agent account,
//      SHA-256("mandate/agent-memory/v1/" + account). The wallet uses Mera's default salt, so the memory key is
//      unlinkable to the account key, and each agent's key is isolated from every other's.
//   2. Derivation. HKDF-SHA-256 over that 32-byte PRF output (info "mandate.memory.x25519.v1") gives an X25519 key
//      pair. It is a pure function of the PRF output, so the same passkey on a second device re-derives it exactly.
//   3. Encryption. The agent runs on a server without the passkey, so it encrypts to the public key: an ephemeral
//      X25519 key agrees a secret with the backer's key, HKDF turns it into an AES-256-GCM key, and the ciphertext can
//      be stored anywhere. Mera's own secret vault can't be used here, because encrypting into it needs the passkey.
//
// Pure JavaScript (@noble), so the agent (Node) and the browser run identical code.
import { x25519 } from "@noble/curves/ed25519.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { bytesToHex, hexToBytes, type Address, type Hex } from "viem";

export const SEALED_ALG = "x25519-hkdf-sha256-aes256gcm";

const DERIVE_INFO = utf8ToBytes("mandate.memory.x25519.v1");
const SEAL_INFO = utf8ToBytes("mandate.memory.aes256gcm.v1");

/** A record sealed to the backer: the ephemeral public key, the nonce and the ciphertext (with its GCM tag). */
export interface SealedRecord {
  v: 1;
  alg: typeof SEALED_ALG;
  epk: Hex;
  nonce: Hex;
  ct: Hex;
}

/** The PRF salt for one agent account's memory: its own namespace, independent of the wallet and of other agents. */
export function memorySalt(account: Address): Uint8Array {
  return sha256(utf8ToBytes(`mandate/agent-memory/v1/${account.toLowerCase()}`));
}

/** The backer's memory key pair, derived from the passkey's PRF output for that agent's salt. Nothing is stored. */
export function memoryKeyPair(prfOutput: Uint8Array): { secretKey: Uint8Array; publicKey: Uint8Array } {
  if (prfOutput.length !== 32) throw new Error("PRF output must be 32 bytes");
  const secretKey = hkdf(sha256, prfOutput, undefined, DERIVE_INFO, 32);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

/** The AES key and associated data for one sealed record. Binding both public keys stops a record being re-targeted. */
function sealKey(shared: Uint8Array, epk: Uint8Array, recipient: Uint8Array) {
  const context = new Uint8Array([...epk, ...recipient]);
  return { key: hkdf(sha256, shared, context, SEAL_INFO, 32), aad: context };
}

/** Encrypts `plaintext` so only the holder of the matching memory secret key can read it. */
export function sealRecord(recipientPublicKey: Uint8Array, plaintext: string): SealedRecord {
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(ephemeral.secretKey, recipientPublicKey);
  const { key, aad } = sealKey(shared, ephemeral.publicKey, recipientPublicKey);
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce, aad).encrypt(utf8ToBytes(plaintext));
  return { v: 1, alg: SEALED_ALG, epk: bytesToHex(ephemeral.publicKey), nonce: bytesToHex(nonce), ct: bytesToHex(ct) };
}

/** Decrypts a sealed record with the backer's memory secret key. Throws if the key is wrong or anything was altered. */
export function openRecord(secretKey: Uint8Array, sealed: SealedRecord): string {
  if (sealed.v !== 1 || sealed.alg !== SEALED_ALG) throw new Error("Unknown sealed-record format");
  const epk = hexToBytes(sealed.epk);
  const recipient = x25519.getPublicKey(secretKey);
  const shared = x25519.getSharedSecret(secretKey, epk);
  const { key, aad } = sealKey(shared, epk, recipient);
  return new TextDecoder().decode(gcm(key, hexToBytes(sealed.nonce), aad).decrypt(hexToBytes(sealed.ct)));
}
