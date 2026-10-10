// Copies docs/paper.md into the app as a string module, so the /manifesto page can be built where Vercel's root
// directory is app/ and docs/ is out of reach. docs/paper.md stays the one source.
//
//   node app/scripts/sync-paper.mjs           write app/src/content/paper.ts
//   node app/scripts/sync-paper.mjs --check   fail if it is out of date (pnpm verify and CI run this)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "docs", "paper.md");
const target = join(here, "..", "src", "content", "paper.ts");

const md = readFileSync(source, "utf8").replace(/\r\n/g, "\n");
const out = `// Generated from docs/paper.md by app/scripts/sync-paper.mjs. Edit the Markdown, then run the script.\nexport const PAPER = ${JSON.stringify(md)};\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== out) {
    console.error("app/src/content/paper.ts is out of date: run node app/scripts/sync-paper.mjs");
    process.exit(1);
  }
  console.log("paper.ts matches docs/paper.md");
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, out);
  console.log(`wrote ${target}`);
}
