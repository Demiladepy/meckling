import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEPLOYMENTS_DIR, loadDeployment } from "./node.ts";

// Testnet always uses the copy bundled in node.ts (Vercel can't read contracts/). On Oct 7 it silently kept the old
// addresses after a redeploy and a setup script wrote to the old registry. This keeps the two in step.
test("the bundled testnet deployment matches contracts/deployments/10143.json", () => {
  const file = JSON.parse(readFileSync(join(DEPLOYMENTS_DIR, "10143.json"), "utf8"));
  assert.deepEqual(loadDeployment("testnet"), file);
});
