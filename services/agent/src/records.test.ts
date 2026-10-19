import { strict as assert } from "node:assert";
import { test } from "node:test";
import { memoryKeyPair, openRecord } from "@mandate/common";
import { publicRecord } from "./records.ts";

const rec = { block: "1", reasoning: "Short BTC: smart money is net short." };

test("without a memory key the public copy is the record as logged", () => {
  assert.deepEqual(publicRecord(rec, undefined), rec);
});

test("with a memory key the reasoning is sealed and only the backer's key opens it", () => {
  const { secretKey, publicKey } = memoryKeyPair(new Uint8Array(32).fill(7));
  const pub = publicRecord(rec, publicKey) as typeof rec & { sealed: Parameters<typeof openRecord>[1] };
  assert.equal(pub.reasoning, "");
  assert.equal(pub.block, "1");
  assert.equal(openRecord(secretKey, pub.sealed), rec.reasoning);
  const other = memoryKeyPair(new Uint8Array(32).fill(8));
  assert.throws(() => openRecord(other.secretKey, pub.sealed));
});
