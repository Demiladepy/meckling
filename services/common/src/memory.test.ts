import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToHex, type Address } from "viem";
import { memoryKeyPair, memorySalt, openRecord, sealRecord, SEALED_ALG } from "./memory.ts";

// Stand-ins for what a passkey's PRF returns: 32 bytes, deterministic per (passkey, salt).
const prfA = new Uint8Array(32).fill(7);
const prfB = new Uint8Array(32).fill(9);
const agent1 = "0xAdb15A72D8e01FC641ad2E218E060e434f2610e0" as Address;
const agent2 = "0xB81b1d54a76170dD0c5c4306f5f0437329afA53F" as Address;

test("each agent gets its own PRF namespace, and address case doesn't matter", () => {
  assert.equal(memorySalt(agent1).length, 32);
  assert.notDeepEqual(memorySalt(agent1), memorySalt(agent2));
  assert.deepEqual(memorySalt(agent1), memorySalt(agent1.toLowerCase() as Address));
});

test("the key pair is a pure function of the PRF output: a second device re-derives the same keys", () => {
  const onLaptop = memoryKeyPair(prfA);
  const onPhone = memoryKeyPair(new Uint8Array(prfA));
  assert.equal(bytesToHex(onLaptop.publicKey), bytesToHex(onPhone.publicKey));
  assert.equal(bytesToHex(onLaptop.secretKey), bytesToHex(onPhone.secretKey));
  assert.notEqual(bytesToHex(memoryKeyPair(prfB).publicKey), bytesToHex(onLaptop.publicKey));
});

test("the memory key is not the PRF output itself (derivation is domain-separated)", () => {
  const { secretKey } = memoryKeyPair(prfA);
  assert.notEqual(bytesToHex(secretKey), bytesToHex(prfA));
});

test("only the backer's key opens a sealed record; anyone can seal to the public key", () => {
  const backer = memoryKeyPair(prfA);
  const sealed = sealRecord(backer.publicKey, "Smart money is leaving BTC; staying flat.");
  assert.equal(sealed.alg, SEALED_ALG);
  assert.equal(openRecord(backer.secretKey, sealed), "Smart money is leaving BTC; staying flat.");
  assert.throws(() => openRecord(memoryKeyPair(prfB).secretKey, sealed));
});

test("every seal is fresh: the same note encrypts differently twice", () => {
  const { publicKey } = memoryKeyPair(prfA);
  const a = sealRecord(publicKey, "same note");
  const b = sealRecord(publicKey, "same note");
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.epk, b.epk);
});

test("tampering with any part of a sealed record is detected", () => {
  const backer = memoryKeyPair(prfA);
  const sealed = sealRecord(backer.publicKey, "a note");
  const flip = (hex: string) => (hex.slice(0, -1) + (hex.endsWith("0") ? "1" : "0")) as `0x${string}`;
  assert.throws(() => openRecord(backer.secretKey, { ...sealed, ct: flip(sealed.ct) }));
  assert.throws(() => openRecord(backer.secretKey, { ...sealed, nonce: flip(sealed.nonce) }));
  assert.throws(() => openRecord(backer.secretKey, { ...sealed, epk: flip(sealed.epk) }));
});

test("rejects a PRF output of the wrong length", () => {
  assert.throws(() => memoryKeyPair(new Uint8Array(16)));
});
