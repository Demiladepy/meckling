# Postmortem, written as we go

What broke while building Mandate, why, and what changed so it doesn't happen again. Kept honest on purpose: a risk product that hides its own failures shouldn't be trusted with anyone's.

## In the product

**A first deposit could be too small to open a Perpl account (fixed Sep 29).** Perpl refuses to open an account below a minimum (100 AUSD on testnet, read from `getMinAccountOpenCNS`). Our staging script and the app's first deposit could go below it and fail with `InsufficentAmountToOpenAccount`. *Change:* the app reads the minimum on-chain and won't let a first deposit go below it.

**Clicking your address signed you out (fixed Sep 26).** Found by the owner while testing. The address chip and the sign-out action shared a click target. *Change:* clicking the address copies it; signing out is a separate, labelled action.

**The judge faucet could burn a rate-limit slot without paying out (fixed Sep 29).** It charged the limit before checking whether the faucet wallet was empty, so a judge could be locked out by a faucet that never paid. *Change:* check the faucet's balance first, then the limit.

**Price protection measured a sell at exactly the band as 1 bps over (found Sep 30, before release).** The distance rounds up, deliberately, so a hair over the limit never passes. An agent aiming exactly at the band edge was therefore blocked. *Change:* the agent sets its slippage at least 2 bps inside the band (`slippageWithinCollar`). The contract stays strict; the agent adapts.

**Reports made on the live site vanished, so their fingerprints couldn't be checked (found Oct 6).** Underwriting reports were kept in server memory and a temp file. Vercel keeps neither, so of the three reports Monad testnet mandates point at, two were gone and the live agent's returned 404. That broke the promise that anyone can check a mandate's evidence. *Change:* reports are stored in Upstash as raw text (the default client re-serialises JSON, which would change the bytes and the hash; a check confirmed nine reports come back byte-exact). The live agent's report also ships with the app. The two lost reports can't be recovered; their mandates were test runs.

## In the infrastructure

**CI was red from Sep 27 to Sep 29.** Two Curvance files were committed without `forge fmt`, and `forge fmt --check` failed every CI run for three days without anyone looking. *Change:* `pnpm verify` runs every CI step locally, and a pre-push hook runs it before anything reaches `main`. It has since stopped a real test bug from reaching `main` (next item).

**A test, not a contract, was wrong about where money goes (fixed Sep 29).** Invariant 2 checks that tokens only move between allowed parties. Its accounting forgot the bond vault, so it failed once the vault held funds (`1242425105 != 1000000000`). The pre-push hook caught it. *Change:* the invariant now checks that the balances of every allowed party add up to the token's total supply, so a forgotten party fails loudly instead of silently.

**A frozen oracle on a local fork stopped all fills after 60 seconds.** An anvil fork freezes Perpl's price oracle, so after a minute every order was refused as stale. *Change:* `pnpm --filter agent fork:sync` copies live marks onto the fork. It refuses to run against anything but localhost.

**Nansen's free credits ran out mid-build.** The agent was calling Nansen on every loop. *Change:* the agent reads the stored, fingerprinted underwriting report instead, which is also more honest: the agent trades on exactly the evidence the backer approved.

**Chainlink CRE rejected the workflow twice (fixed Sep 29).** Javy, which compiles the workflow, rejects exported functions that take parameters, and the report receiver must be given as hex, not base64. Neither is obvious from the docs. *Change:* both fixed, and recorded in `docs/cre-simulation.md`. A real breach was then flagged through CRE on Monad testnet.

**Envio's code generator has no Windows binary.** *Change:* `pnpm verify` skips that one step on Windows and says so; CI runs it on Linux.

**A setup script wrote to the old contracts after the redeploy (Oct 7).** Testnet addresses are bundled in `services/common/src/node.ts` so Vercel can read them, and that copy still held the old addresses. The first run of the live agent's setup created an account on the old factory before failing on the old registry. Harmless (a test account), but it would have pointed the live site at stale contracts. *Change:* the bundled copy was updated, and a test now fails if it ever differs from `contracts/deployments/10143.json`.

## In the proofs

**Halmos "timed out" on proofs that were trivial (found Sep 30).** On Windows, the yices 2.6.4 solver build never answers a query declared `QF_AUFBV`, even one with an obvious answer. We first read the timeouts as hard proofs. *Change:* a small wrapper (`test/formal/yices_all_logic.py`) changes only the logic line; the suite now runs in about a second. Lesson: before believing a timeout, run the solver on the smallest query by hand.

**Four properties couldn't be proven, and we say so.** Properties that multiply two unknowns (rounding of the price distance; monotonicity of the leverage and drawdown limits) don't finish in the solver even with tight bounds. *Change:* they're fuzzed at 10,000 runs each, and `docs/formal.md` lists them as tested, not proven.

## In what we claimed

**The first demo agent was scripted.** For the Meridian video, the agent's reasoning came from a scripted provider that quotes the real Nansen report and deliberately tries 12× leverage. The blocked transaction, the fill and the breach were real on-chain events. *Change:* the README and the live site say so. Scripted demos are labelled scripted.

**The first breach was flagged by our fallback keeper, not CRE (Sep 23).** We said so at the time. CRE flagged its own real breach on Sep 29.

**We claimed gas savings before measuring them, and the estimate was 2.3× too high (measured Oct 7).** We calculated about 48,600 gas saved from the 6-rule page count. Measured with `eth_estimateGas` on the same 4-rule account, old contracts against new, the saving is **21,342 gas**. The calculation assumed three rule monitors on three pages; a 4-rule account has one, so the old layout cost about 3 extra cold pages, not 6. *Change:* the number in the README is the measured one, and `pnpm --filter agent measure:gas` reproduces it. Lesson: a page count is a model; the chain's own estimator is the measurement.

**A research summary we were handed was half wrong (Oct 2).** An AI-generated overview listed agent incidents. Checked against primary sources, about half held up and half didn't (a "$500M AI flash crash" that no source attributes to AI; a "$1M Clawdbot loss" that exists only as a viral post). *Change:* `docs/research.md` keeps only what was verified, with sources, and marks the rest "don't use".
