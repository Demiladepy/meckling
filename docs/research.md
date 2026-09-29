# Research — the argument behind Mandate

Compiled Sep 29, 2026. Every source below was checked to exist before it went in. Sources from the owner's reading
list that could not be verified, or that contain errors, are listed separately — do not cite those.

## The frame in one paragraph

Markets learned the hard way that automated traders need **pre-trade limits enforced by someone other than the
trader**. After the 2010 Flash Crash, the SEC made that law for brokers (Rule 15c3-5); in 2012 Knight Capital's system
sent millions of unwanted orders in 45 minutes and lost more than $460 million, and the SEC's case was that its pre-trade
controls failed. AI agents now trade on-chain with no broker in between, so nobody enforces those limits for them.
**Mandate is Rule 15c3-5 for AI agents — enforced by the chain inside every trade, with a bond (Jensen & Meckling's
"bonding") that pays the backer when the market breaks a limit the trade itself couldn't.**

## Verified sources and what each gives us

| Source | What it establishes | How it maps to Mandate | Use it in |
|---|---|---|---|
| **SEC Rule 15c3-5, the Market Access Rule** (adopted 2010) | Brokers with market access must run **automated, pre-trade** risk controls: reject orders that exceed pre-set credit or capital thresholds, and erroneous orders that exceed price or size parameters, order by order or over a short period, or that look duplicative | `MaxNotionalPerMarket` and `MaxLeverage` are the capital thresholds; `OrderRateLimit` is "over a short period of time"; the check runs inside `execute`, before the order reaches Perpl. **Gap: no price parameter** — see "What this tells us to build" | Pitch, README, "why this market doesn't exist" |
| **SEC v. Knight Capital Americas LLC** (settled Oct 16, 2013, $12M) | Aug 1, 2012: a Knight system routed millions of orders in 45 minutes, >4 million executions in 154 stocks, **lost over $460 million**; charged under 15c3-5 for failing to prevent erroneous orders | The canonical story of an automated trader with limits that existed on paper but not in the execution path | Pitch opener |
| **Jensen & Meckling (1976), "Theory of the Firm: Managerial Behavior, Agency Costs and Ownership Structure"**, *Journal of Financial Economics* | Agency costs = the principal's **monitoring** + the agent's **bonding** + residual loss | Rules = monitoring, operator bond = bonding, the slash = the bond paying out. Mandate lowers agency costs by making both mechanical | Pitch ("agency theory, enforced by a VM"), README |
| **Anderson (1972), "Computer Security Technology Planning Study"** | The *reference monitor*: always invoked, tamper-proof, small enough to verify | `MandateAccount.execute` is on every trade's path, the agent's key can't bypass it, the rule libraries are small and tested | Technical write-up |
| **Kirilenko, Kyle, Samadi & Tuzun (2017), "The Flash Crash: High-Frequency Trading in an Electronic Market"**, *Journal of Finance* | How automated traders amplified the May 6, 2010 crash | Market rules (drawdown, loss cooldown) are account-level circuit breakers; close-only is the kill switch | Pitch, if asked about systemic risk |
| **Budish, Cramton & Shim (2015), "The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response"**, *Quarterly Journal of Economics* | Continuous markets create a socially wasteful speed race (sniping stale quotes) | Context, not a feature: Mandate agents are takers and aren't in the speed race. Useful to show you know the literature critiquing automated trading | Q&A only |
| **Havelund & Roşu (2002), "Synthesizing Monitors for Safety Properties"**, TACAS | Past-time temporal-logic monitors with constant memory | How the cooldown, rate-limit and drawdown rules keep constant-size state on-chain | Technical write-up |
| **Ledger Academy, "Guardrails for Autonomous Crypto Trading Agents"** (N3XT research series) | Soft guardrails (prompt filters) vs hard ones (account abstraction, ZK); programmable limits like per-trade caps enforced at signing | The closest framing to Mandate in industry. Mandate is a hard guardrail — and adds what signing-time limits can't: rules over *time* (drawdown from peak, cooldowns) and a bond for market-caused breaches | Competitive landscape |
| **Rashie & Rashi (2026), "Type-Checked Compliance: Deterministic Guardrails for Agentic Financial Systems Using Lean 4 Theorem Proving"**, arXiv 2604.01483 | Agent actions execute only if a Lean 4 kernel proves them compliant; argues LLMs are "probabilistic, non-deterministic systems operating in domains that demand absolute, mathematically verifiable compliance guarantees" | Same thesis (deterministic > probabilistic). Difference: their checker runs on someone's server; Mandate's runs inside the chain's state transition, so neither the agent nor the operator can skip it | Competitive landscape, originality |
| **AgentDoG (2026), "A Diagnostic Guardrail Framework for AI Agent Safety and Security"**, arXiv 2601.18491 (Shanghai AI Laboratory) | A model that classifies and diagnoses unsafe agent trajectories | The *soft* end of the spectrum: a model judging a model. Useful contrast — Mandate doesn't judge intent, it makes the unsafe action impossible | Contrast only |
| **"Giving AI Agents Access to Cryptocurrency and Smart Contracts Creates New Vectors of AI Harm"**, arXiv 2507.08249 | Argues agents with on-chain access create new harms | The problem statement Mandate answers | Problem framing |

## From the owner's list — status

| Item | Status |
|---|---|
| Budish, Cramton & Shim (2015) | Verified (above) |
| Menkveld; O'Hara on HFT market structure | Real literature; exact titles not checked here — look up before citing |
| Cartea & Penalva (2012) | Real ("Where is the value in high frequency trading?"); not central to Mandate |
| Boehmer, Fong & Wu, algorithmic trading and market quality | Real line of work; check the year and journal before citing |
| Aman Seth (2026), SSRN 6143508 | Exists, but it is a **6-page note**. Too thin to lean on in front of finance judges |
| Ledger N3XT "Guardrails for Autonomous Crypto Trading Agents" | Verified (above) |
| AgentDoG (2026) | Verified (above) |
| "A Decentralized Identity and Trust Fabric for Secure Coordination Among AI Agents, Wallets, and Smart Contracts" (2026) | **Not found under that title.** Related, real: arXiv 2607.00245 ("Agent-to-Agent Finance: Blockchain Payments and Trust Infrastructure"). Don't cite the original title |
| "Adaptive Reinforcement Learning Agents Coordinated through Blockchain Smart Contracts" | Not verified. Don't cite |
| Polymarket "prevents wash trading" claims | Not a paper; the claim is overstated. Don't cite |

## Corrections to the Monad facts in the list

- Blocks are ~**400 ms** with ~**800 ms finality** (Metropolis track page); we measured **~0.30–0.31 s** per block on
  testnet over 2,000 blocks (`docs/spikes.md`). "10,000 TPS with 1-second blocks" is out of date.
- The list names three pillars and calls them four. The missing one is **asynchronous execution** — consensus runs ahead
  of execution — and it is exactly why Monad **charges the full gas limit**, which Mandate designs around.
- **MIP-8** prices storage by 128-slot page (8,100 gas for the first read on a page, 100 after), live per Monad's
  opcode-pricing docs. Mandate's enforcement overhead is ~214k gas per trade today (`docs/benchmarks.md`).

## What this tells us to build or change

1. **A price collar rule** (candidate D13). 15c3-5's "erroneous order" test includes a *price* parameter; Mandate has
   size and capital limits but no price check. A rule that rejects any order whose limit price sits more than N bps
   from the oracle-trusted mark would stop fat-finger and manipulated-price orders — the Knight failure mode. It's
   outside the PRD, so it needs the owner's yes (CLAUDE.md rule 1).
2. **Prove the rules, don't just fuzz them.** The Lean paper's point applies to us: the rule libraries are small pure
   functions. Symbolic tests (Halmos, whose cheatcodes already ship in our OpenZeppelin dependency) can prove properties
   like "`isTightening` never allows a looser limit" for *all* inputs, not 16,000 random ones. Fits M4 hardening.
3. **Say "Rule 15c3-5 for AI agents"** in the pitch and the README. Finance judges will recognise it instantly, and it
   answers "why doesn't this market exist yet": the control existed for human brokers, and nothing enforces it for
   agents trading on-chain without a broker.
