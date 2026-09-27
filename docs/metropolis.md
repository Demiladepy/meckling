# Metropolis — the plan to Oct 11

Written Sep 27. Submission-ready by **end of Oct 11** (PRD: submit Oct 12, Oct 13 is buffer only). Fourteen working
days. Nansen Meridian is submitted; everything from here is for Metropolis.

## The honest assessment

The contracts, the enforcement and the evidence trail are strong and rare. Three things are weak, and they are what a
main-track judge will notice first:

1. **The agent on the public site is scripted.** "AI traders that can't break your rules" is shown with an agent that
   isn't AI. Nothing we add will outweigh a real model trading live for ten days with a public record.
2. **The public site cannot show live reasoning.** The agent writes its log to the machine it runs on; Vercel never
   sees it. A live agent is invisible until its records are published somewhere the app can read.
3. **No one but us has used it.** Ten real people creating self-mandates on their phones is worth more than any new
   feature.

Everything below is ordered by what moves the result most, not by what is most fun to build.

## Priorities

### P0 — decides the main track

| # | Work | Owner | Needs |
|---|---|---|---|
| 1 | **Run the Claude agent live, continuously, from ~Sep 30.** Ten days of real trades, blocks and fills | Both | An always-on host (a small VPS or Railway, ~$5–10/mo). Owner decides and creates the account |
| 2 | **Publish agent records to durable storage** the app reads (so the public split screen shows live reasoning) | Me | A store: Vercel Blob or Upstash Redis (free tiers). Owner creates it and adds the token to Vercel |
| 3 | **Phone test**: Mera passkey sign-in, installed PWA, AUSD balance, a trade, a block — recorded on the phone | Owner | A phone. Unlocks Agora ($10k) and Mera ($2.5k) |
| 4 | **Ten real users** create self-mandates. Their accounts become the agents list | Owner | Friends, the Monad Discord, X |

### P1 — sponsor bounties one step from live

| # | Work | Owner | Needs |
|---|---|---|---|
| 5 | **Envio live**: root folder `indexer`, then I wire the URL into track records and the Risk screen | Owner, then me | The dashboard setting |
| 6 | **Chainlink CRE**: `cre login`, then I deploy the receiver, simulate the workflow and save the logs | Owner, then me | Five minutes of the owner's time |
| 7 | **Perpl risk tool**: live Perpl WebSocket on the Risk screen, as the PRD promises | Me | Perpl's WS docs (spike S1 recorded the limits) |

### P2 — the Monad-native story

| # | Work | Owner | Needs |
|---|---|---|---|
| 8 | **MIP-8 storage layout.** Enforcement adds ~214k gas per trade today (`docs/benchmarks.md`). Monad now prices storage by 128-slot page: 8,100 gas for the first read on a page, 100 after. Lay rules and monitor state out contiguously so one trade touches as few pages as possible, redeploy, re-measure | Me | Foundry tests stay green; a before/after number |
| 9 | **Mainnet**, with small funds, if the judging rewards it | Owner decides | An answer to question 5 below |

### P3 — only if P0–P2 are done

- `CurvanceCollateralAdapter` (config-only; PT-AUSD matures Oct 8).
- A "Mandate skill" on top of nansen-skills.
- Ultrafuzz and the security write-up (M4).

### Oct 9–11 — story

Final video, README numbers refreshed from the live agent, landing page polish, submit.

## Questions the owner must answer

A mentor would ask these. Write the answers down; the pitch is the answers.

1. **Have you read the Metropolis judging criteria and every targeted bounty's current wording this week?** This plan
   works from a PRD snapshot written before the hackathon started. Paste them into `docs/` so nothing drifts.
2. **What is the main-track prize, and can one project also win sponsor bounties?** That decides whether breadth or
   depth wins.
3. **Who is the user, in one sentence — the backer or the self-trader?** The main-track story has to pick one.
4. **Name three real people who would back an agent. Have you asked them what would make them do it?**
5. **Would you put $100 of your own on mainnet under Mandate?** If not, why would a judge believe in it?
6. **Why not just use the exchange's own risk limits, or a centralised risk engine?** Have the answer in one line.
7. **The agent is right and a rule blocks it. What does the backer do?** Rules can only tighten today.

## Reading that strengthens the argument

Real papers, each mapping directly onto something Mandate already does:

- **Jensen & Meckling (1976), "Theory of the Firm: Managerial Behavior, Agency Costs and Ownership Structure."**
  Agency costs are *monitoring* by the principal, *bonding* by the agent, and residual loss. Mandate enforces the
  first two in code: the rules are the monitoring, the operator's bond is the bonding. This is the strongest framing
  available: *Mandate is agency theory, enforced by a virtual machine.*
- **Anderson (1972), "Computer Security Technology Planning Study."** Defines the *reference monitor*: always invoked,
  tamper-proof, small enough to verify. `MandateAccount.execute` is a reference monitor for an agent's capital.
- **Saltzer & Schroeder (1975), "The Protection of Information in Computer Systems."** Least privilege and complete
  mediation: the session key that can trade but never withdraw.
- **Havelund & Roşu (2002), "Synthesizing Monitors for Safety Properties."** Past-time temporal-logic monitors with
  constant memory — exactly how the cooldown, rate-limit and drawdown rules keep constant-size state.

On stablecoins and agent payments: they are relevant as context (AUSD is the collateral and the bond), but do not bolt
on an x402 or payments feature unless it becomes load-bearing. Scope is the enemy now.

## Decisions taken

- **Not entering a Hyperliquid track in parallel** unless its rules and dates are checked and it costs no Metropolis
  time. Technical reason to verify first: Mandate's guarantee is that a trade and its rule check happen in one
  transaction. On Hyperliquid, orders placed from HyperEVM reach HyperCore through a system contract and, as far as
  we know, execute after the EVM transaction rather than inside it — if that holds, the core guarantee does not port.
