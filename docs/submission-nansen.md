# Nansen Meridian Buildathon — what has to be true by Sep 27

Today is **Sep 24**. Three days. This file is the whole checklist; work top to bottom and stop at "nice to have"
if time runs out.

## What the judges are actually rewarding

The bounty reads: *"a product experience powered by Nansen data, API, MCP or CLI that goes beyond exposing raw
data."* Nearly every entrant will show a dashboard that prints Nansen numbers on a page. **The winning argument for
Mandate is one sentence:**

> Nansen evidence doesn't inform a human decision here — it is compiled into limits a smart contract enforces, and
> the report that justified them is hashed on-chain with the mandate.

Everything below exists to make that sentence undeniable in 3 minutes.

## Blocking — the submission fails without these

- [ ] **Nansen credits.** 30,000 added; confirm a live call still succeeds the morning of the recording. If the
      plan is exhausted again, the demo shows sample data and the argument collapses. Check first, not last.
- [ ] **A fresh underwriting on camera**, live, with the report hash visible, then the same hash read back from
      `MandateRegistry` on-chain. The hash on screen must match the hash in the explorer. This is the proof.
- [ ] **A blocked trade on camera.** The agent proposes, `execute()` reverts, the screen says *"Blocked: this trade
      would put you at 4.2x leverage. Your limit is 3x."* Nothing changed on-chain.
- [ ] **Public repo.** It is private today. Make it public before submitting; no secrets are in git (the scan in
      CLAUDE.md returns 0).
- [ ] **A live URL.** Deploy the app (Vercel is fine, `NETWORK=testnet` plus the QuickNode URL and Nansen key as
      environment variables). Judges click links; they do not clone repos.
- [ ] **The 3-minute video**, in this order:
      1. Nansen underwriting runs live — smart-money flows on screen, limits proposed from them (20s)
      2. Backer approves; the mandate and `reportHash` land on-chain (30s)
      3. The agent trades; a good trade fills (20s)
      4. The agent tries a trade that breaks a limit; the chain reverts it (40s)
      5. The market breaks a rule; the keeper flags it, the position unwinds, the bond pays the backer (50s)
      6. One closing line: *rules a human wrote from Nansen evidence, enforced by the chain, paid out in AUSD* (10s)
- [ ] **README rewritten for a judge**, not a developer: the one-sentence argument, the live URL, the video, the
      addresses, then how it works. Disclose honestly what is scripted, what is sample data and which keeper ran.

## Strong — this is what separates first from third

- [ ] **Show the evidence, not the conclusion.** On the underwriting screen, every proposed limit must name the
      Nansen signal that produced it: *"$160 on BTC — smart-money netflow turned negative over 7 days."* A judge
      who sees the chain of evidence → limit → on-chain enforcement cannot mistake this for a dashboard.
- [ ] **Make the hash checkable.** A "verify" affordance that shows the stored report, recomputes its hash in the
      browser and compares it to the on-chain value. Trust nothing, check everything.
- [ ] **Name the numbers.** Blocked in N blocks, flagged in 6 blocks, bond paid $0.109218 — the exact loss from
      peak. Specific numbers read as real work; round numbers read as marketing.
- [ ] **One screenshot in the README that tells the whole story** — the split screen with a revert on the right.
- [ ] **Say what Nansen is not doing.** Admitting the agent's reasoning model is Claude and Nansen sets the limits
      is more convincing than implying Nansen does everything.

## Nice to have

- [ ] Agents list with track records from the indexer (also serves the Envio bounty).
- [ ] The landing page in one scroll with the live split screen embedded.
- [ ] Breach detail screen with the dispute countdown.

## Already done — say these plainly, they are the credibility

- Live on Monad testnet: mandate created from live Nansen evidence, a 12x trade reverted with `MandateViolation`
  (observed 11.3x against a 1.5x limit), then a 0.7x trade filled on Perpl.
- A real breach: flagged in 6 blocks, position unwound into close-only, bond paid the backer $0.109218 after the
  dispute window. Flag `0x76f0f447…`, slash `0xacfd9371…`.
- Self-mandate on a phone surface, proven on testnet: $50 long filled, $220 long blocked by the trader's own rule.
- Eight PRD invariants hold over 16k fuzzed calls; fork tests run against real Perpl at mainnet state.

## The three things most likely to lose it

1. **Nansen credits running out mid-demo.** Check before recording.
2. **A private repo or a dead link** at judging time.
3. **Leading with architecture instead of the argument.** The first 20 seconds must show Nansen data becoming a
   limit. Not the contract diagram.
