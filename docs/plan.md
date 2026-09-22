# Plan and status

Living checklist against the PRD's milestones. **Update this file whenever a box changes.** Every "done" box means it was run and the output seen, not that the code looks right.

Last updated: Sep 23, 2026.

## Where we are

**M0 and M1 are done. M2 is next.** The enforcement core is live on Monad testnet and has been exercised end to end there and against real Perpl on a mainnet fork.

## M0 — Spikes and scaffold (due Sep 22) — **done**

- [x] S1 Perpl from a contract — passes, proven by a mainnet fork test
- [x] S2 Curvance AUSD borrow — passes, markets and LTVs read on-chain
- [x] S3 Mera passkeys — passes on docs; **open: installed-PWA (standalone) mode is untested on a real phone**
- [x] S4 Chainlink CRE on Monad — supported on paper; confirm with `cre workflow supported-chains` when the owner has an account
- [x] S5 Price sources — Chainlink feeds confirmed live on mainnet; testnet has BTC and ETH only, with a 24 h heartbeat
- [x] S6 Nansen API — verified live; lowercase-address finding recorded
- [x] S7 Envio on Monad — HyperSync supports 143 and 10143
- [x] Monorepo, Foundry project, PWA shell, `.env.example`, CI running `forge test`

## M1 — Nansen slice and enforcement core (due Sep 27, Meridian) — **done except the recording**

- [x] `MandateRegistry`, `MandateAccount`, `MandateAccountFactory`
- [x] Action rules: MaxLeverage, MaxNotionalPerMarket, AllowedMarkets, OrderRateLimit, LossCooldown (+ MaxDrawdown peak tracking, flagged in M2)
- [x] `PerplAdapter` per spike S1, with a selector allowlist (decisions D1, D2)
- [x] Unit tests (55) and invariants 1, 2, 3, 4, 7, 8 over 16k fuzzed calls
- [x] Mainnet-fork test: a real trade fills on Perpl, a 12x trade reverts with `MandateViolation`
- [x] Nansen underwriting service: evidence → regime → limits → report hash on-chain
- [x] Agent runtime placing real Perpl orders through `MandateAccount.execute` (Claude or Kimi; scripted demo mode)
- [x] Create mandate screen and the split-screen agent view
- [x] Deployed to Monad testnet; a live mandate created from live Nansen evidence; the 12x trade blocked on-chain
- [ ] **Record the Meridian video** (underwriting screen → on-chain mandate with report hash → blocked trade) and submit by Sep 27
- [ ] Needs: Nansen credits (the free plan is exhausted) for live evidence on camera

## M2 — Market rules, bond and keeper (Sep 28 – Oct 3) — **next**

- [ ] `MaxDrawdown` flagging path (the peak monitor already exists and updates on every execute and `poke`)
- [ ] `BondVault`: post, flag, dispute window, slash, resolve
- [ ] `OracleGuard`: Perpl mark vs Chainlink feed, tolerance band and staleness (PRD 7.5, spike S5)
- [ ] Invariants 5 and 6 (flag only on a real breach; never slash twice or beyond the bond)
- [ ] CRE keeper workflow + `CreKeeperReceiver`, and the fallback relayer sharing its logic
- [ ] Envio indexer: mandates, executions, violations, breaches, equity points
- [ ] Exit: a market move triggers a breach, the keeper flags it, the position unwinds, the bond pays the backer after the dispute window

## M3 — Capital, mobile and risk surfaces (Oct 4–8)

- [ ] Mera passkey accounts across the app (sign-in exists; **test on a real phone, including installed-PWA mode**)
- [ ] Self-mandate mode (the Agora surface)
- [ ] Risk screen (the Perpl analytics surface)
- [ ] `CurvanceCollateralAdapter` (earnAUSD; PT-AUSD matures Oct 8, so it is config-only)

## M4 — Hardening and story (Oct 9–11)

- [ ] Ultrafuzz on `contracts/`, findings fixed, report committed
- [ ] `docs/benchmarks.md` filled with measured numbers
- [ ] Landing page, README, demo video
- [ ] Submission checklist (PRD 15), repo made **public**

## Measured so far

| Metric | Value | How |
|---|---|---|
| Gas, enforced trade (4 rules) | ~313k | mainnet fork, `test_gasPerEnforcedTrade` |
| Gas, raw Perpl IOC fill | ~153k | spike S1 trace |
| Monad block time | ~0.30 s mainnet, ~0.31 s testnet | measured over 2,000 blocks |
| Tests | 62 Foundry, 12 TypeScript | `forge test`, `pnpm test` |

## Open questions for the owner (PRD 17)

1. ~~Spike S1 result~~ — passed, no fallback needed.
2. **Agent model** — Claude (`claude-opus-5`) works and is wired. Kimi is implemented but untested; the Kimi bounty needs Kimi to be the model actually used.
3. **Mainnet vs testnet for the final demo** — testnet works today; mainnet is needed for M2's oracle guard, because testnet feeds update once a day.
4. **Dispute arbiter** for the demo configuration.
5. **Final product name.**
