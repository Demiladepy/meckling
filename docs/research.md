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

## Incidents and comparables, checked Oct 2

The owner collected these from a Google AI overview. Each one was checked against a primary or reputable source before it went in here. **Only the "use" rows may appear in the pitch, README or video.**

| Claim | Verdict | Source | What it means for Mandate |
|---|---|---|---|
| aixbt: 55.5 ETH (~$106k) sent out of the agent's Simulacrum wallet by two queued malicious replies, Mar 18 2025 | **Use** | Cointelegraph via TradingView (Mar 18 2025); Decrypt; AI Incident Database #1003; Basescan tx `0xddf07a87…5ee2a` | The agent key could move funds anywhere. A Mandate session key can't: it can only approve AUSD to Perpl, deposit, add margin and place, close or cancel orders. Transfers, venue withdrawals and approvals to anyone else revert (`test/MandateAccount.t.sol` `test_refusesTokenTransfer`, `test_refusesVenueWithdrawFromSessionKey`, `test_refusesApproveToOtherSpender`). |
| Lobstar Wilde: an agent built by an OpenAI employee sent 52.4M LOBSTAR tokens to a stranger, Feb 22 2026 | **Use, with the range** | Cointelegraph via TradingView (Feb 22 2026) reports $441,780; Finance Magnates reports ~$250k. Say "$250k–$441k by different reports" | Same class: an agent with transfer power and no hard bound. Mandate's agent has no transfer power. |
| Alpha Arena Season 1: six LLMs, $10k each, live crypto perps on Hyperliquid, Oct 18 – Nov 3 2025. Qwen3 Max +22.3%, DeepSeek V3.1 +4.89%, Claude Sonnet 4.5 −30.81%, Grok 4 −45.3%, Gemini 2.5 Pro −56.71%, GPT-5 −62.66% | **Use, cite as reported** | Season end date from nof1.ai's own blog snippet; final returns from iWeaver's write-up citing nof1.ai (nof1's results page now 404s) | The closest evidence to our exact use case: frontier models trading perps lost up to 63% in about two weeks. Nothing enforced a drawdown floor. Our MaxDrawdown rule plus the bond is the answer. |
| TRM Labs: nine YouTube tutorials for a "Claude-built arbitrage bot" led 224 victims to deploy self-draining contracts, 274.60 ETH, Feb–Aug 2026 | **Use only if relevant** | TRM Labs blog, "Fake AI Trading Bots Are Getting Victims to Build Their Own Drainers" | A scam, not an agent failure. Useful only for "people can't verify what an AI bot does"; Mandate's rules are readable on-chain. The "$517k" figure isn't in TRM's text; use the ETH figure. |
| Mirror Trading International: 29,421 BTC (> $1.7B) from at least 23,000 US individuals; claimed an AI trading bot | **Use only for "track records can be faked"** | CFTC press releases 8549-22 (Jun 30 2022) and 8772-23 | A Ponzi, not an agent. Contrast: a Mandate track record is on-chain and indexed, so it can't be invented. |
| Hyperliquid vault leaders must keep at least 5% of the vault and can't withdraw below it; 100 USDC minimum to create | **Use** | Hyperliquid Docs, "For vault leaders" (owner's screenshot) | The nearest skin-in-the-game comparable. It aligns the leader's incentives but enforces no trading rule and pays depositors nothing when one is broken. Mandate's bond is tied to specific rules and pays the backer on a breach. |
| Numerai: stakers earn or burn NMR on scored predictions; Signals payout = stake × clip(payout_factor × score, ±3.5%) per round | **Use as the bond-sizing comparable** | docs.numer.ai, Signals staking page | A per-round stake at risk, clipped to a few percent. A model for sizing operator bonds against measurable performance. |
| Coinbase Spend Permissions: a spender may spend up to an allowance of one token per period from a smart account | **Use in "why not X"** | docs.cdp.coinbase.com spend-permissions; github.com/coinbase/spend-permissions | Caps *how much leaves*, not *what the trades do*. It can't express leverage, position size, drawdown or a price band, and pays nothing on a breach. |
| iEarn Bot, CBEX "AI trade gone wrong" | **Don't use** | No primary source checked; these are frauds, not agent failures | Off-topic. |
| Clawdbot traded a $1M portfolio to zero | **Don't use** | Only a viral X post and reposts; no evidence it was real money | Might be a joke. One unverified claim on camera costs more credibility than it buys. |
| "$500M AI liquidation flash crash" caused by AI agents | **Don't use** | The Oct 10–11 2025 cascade is real, but no source attributes it to AI agents | Repeating it would be false. |
| ERC-7579 is too rigid for "probabilistic" agents and needs "intent-based flexibility" | **Reject the framing** | Opinion piece, not evidence | It argues against our thesis. Hard, deterministic bounds are the point. ERC-7579 is a module standard; policies live in modules. The honest contrast: generic session-key policies check a call's parameters, while Mandate checks the account's state after the trade (leverage, drawdown, position size), which call-level policies can't see. |

The Chainalysis staking article (Apr 22 2024) covers proof-of-stake slashing generally (e.g. 32 ETH to run an Ethereum validator) and doesn't mention Numerai. The Rox article (Jul 3 2026) is about enterprise agents; its one useful line is a Gartner forecast that 50% of AI agent deployment failures by 2030 will come from insufficient runtime enforcement. Cite it as Rox citing Gartner, not as Gartner.
