# Week of Sep 28 – Oct 3

Goal for the week: **close every "you" blocker, get a real agent live, and fix the two gaps that cost the most points**
(founder/market readiness and traction are 45% of the main-track score; see `metropolis.md`).

**You** = the owner. **Claude** = coding agent. A "you" item left undone blocks the "Claude" item after it.

## Monday Sep 28 — unblock everything

**You**
- [ ] Envio dashboard: set root folder to `indexer`, config `config.yaml`, deploy branch `main`. Send the GraphQL URL.
- [ ] Run `cre login` in a terminal and finish the browser flow.
- [ ] Open the Metropolis **Rules** modal and paste it into `docs/metropolis-rules.md` (AI disclosure, video limits,
      team size, one-track rule).
- [ ] Check your profile's community field: is your group on the onboarded list? (Community supporters bounty.)
- [ ] Decide the agent's host: a small VPS or Railway (~$5–10/month). Create the account.
- [ ] Create a free Upstash Redis (or Vercel Blob) store for agent records; add its token to Vercel env yourself.
- [ ] Send the two messages below (senior builder, Category Labs).

**Claude**
- [ ] Chainlink CRE: add the external call — before flagging a breach, the workflow confirms the price against Perpl's
      own API, so a breach needs two independent sources. Then simulate with the CLI and save the logs.
- [ ] Judge access: a rate-limited testnet faucet in the app (test MON + AUSD to a new passkey account), so judges can
      use the product with no setup.

## Tuesday Sep 29 — the agent goes live

**You**
- [ ] Mainnet decision: yes or no to deploying Mandate on Monad mainnet with small caps (unlocks the Curvance Fund
      screen and "I ran my own money through it").
- [ ] Put a faucet wallet key in Vercel env (Claude tells you the variable name; never paste it in chat).
- [ ] First X post: the gas number (enforcement adds ~214k gas per trade; MIP-8 is the next move).
- [ ] Message the sponsor channels with the one-question templates (Perpl, Chainlink, Envio, Agora).

**Claude**
- [ ] Agent records published to the store, so the public agent screen shows live reasoning.
- [ ] Agent runtime hardened for a long run (restarts, a health log), with a deploy script for your host.
- [ ] Start the Claude agent on a fresh Nansen mandate. From here it runs until submission.

## Wednesday Sep 30 — mobile and the passkey

**You**
- [ ] **Phone test** of `/trade`: passkey sign-in, installed to home screen, AUSD balance, a filled trade, a blocked
      trade. Screen-record it on the phone. This is the Agora deliverable.
- [ ] Logo (≤3 MB, PNG). Simple: the half-grey, half-white square mark in the header is a fine start.
- [ ] Read Jensen & Meckling (1976), sections 1–2 only. Write three sentences on how Mandate maps to it.

**Claude**
- [ ] Wire the Envio GraphQL URL into track records and the Risk screen; verify the numbers against chain state.
- [ ] Fix whatever the phone test breaks.

## Thursday Oct 1 — the Mera feature and users

**You**
- [ ] **User interviews**: three real people, the same question — *"If an agent's rules were enforced on-chain and its
      operator had a bond you'd get paid from, would you put $500 behind it? What would make you say no?"* Write down
      the answers word for word, including the nos.
- [ ] Second X post: a clip of a blocked trade.

**Claude**
- [ ] Mera non-wallet feature: the backer's private notes and the agent's memory encrypted to the backer's passkey
      (its own PRF salt namespace), readable on a second device with the same passkey. Nothing stored in plain text.

## Friday Oct 2 — measure and tell the story

**You**
- [ ] Get **ten people** to try `/trade` with the judge faucet. Note every place they got stuck.
- [ ] Draft the 2-minute pitch video script: who you are, the problem, why you, the first user (from the interviews).
- [ ] Reply to Harpush's Moose post with our gas numbers.

**Claude**
- [ ] MIP-8: measure gas with six rules, lay rule and monitor state out to touch fewer storage pages, re-measure,
      update `benchmarks.md`.
- [ ] Refresh the README with the live agent's numbers.

## Saturday Oct 3 — review

**You and Claude**
- [ ] Walk the whole product as a judge would, from the landing page with an empty wallet. Fix the top three problems.
- [ ] Check this list. Anything unticked moves to next week's first day.
- [ ] Third X post: the week in numbers.

## Not this week (on purpose)

- Perpl analytics dashboard bounty — skipped (see `metropolis.md`).
- Kuru or any second venue — not load-bearing; Perpl is the venue.
- `proposeLoosen` (D12) and the `CollateralHealth` rule (D11) — next week, after the plan is finished.
