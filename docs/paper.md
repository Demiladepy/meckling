# Meckling: limits an AI trader cannot break

*Demilade Ayeku · Monad Metropolis 2026 · Track 01, Onchain Finance & Trading*

## A letter

I started building Meckling after watching AI agents lose money in public. One was talked into sending away its wallet. One misread a post and sent a stranger a quarter of a million dollars in tokens. In a live contest, frontier models given real money to trade perpetuals lost up to 63% in about two weeks. None of these were exotic attacks. In each case, nothing outside the model said no.

The usual answer is a dashboard: watch the agent, get an alert, step in. That asks the person who funded the agent to become a full-time risk desk. I think that is the wrong job to give them. Monad's co-founder put the general version of this well: fair execution should be a property of the infrastructure, because it is unreasonable to expect every user to become an expert before they can trade safely. Meckling applies the same idea to risk.

This paper explains what Meckling guarantees, how it does it on Monad, what it measured, and where it stops. Where an argument has a weak point, the weak point is stated where the argument is made, not in a footnote.

## Why the name

In 1976, Michael Jensen and William Meckling described what it costs to hand someone else control of your money. The owner pays to watch the agent (monitoring costs), and the agent puts something at stake to prove it will behave (bonding costs). Fifty years later the agent is software, but the problem is the same one. Meckling, formerly called Mandate, is named for that paper: it does the monitoring inside every trade, on Monad, and holds the operator's bond until the backer is paid.

## Thesis

**Spend caps changed how much an agent can move. Meckling changes what it is allowed to do over time.**

A per-transaction limit made sense when a key could do one thing: send one payment. An AI trader opens, adds, closes and flips positions a hundred times a day. The risk is not any single transfer. It is leverage, concentration, the size of a losing streak, and what the agent does right after a loss. Those are properties of an account's state over time, and a spend cap cannot see them.

Meckling checks those properties inside the agent's own transaction, after the trade has been applied and before it is final. A trade that would leave the account outside its rules reverts, and nothing reaches the exchange. A loss the market causes on its own, with no trade at all, is flagged by anyone, re-checked by the chain, and paid back from a bond the operator posted in advance.

**The test we hold ourselves to:** if a backer has to watch a dashboard to stay safe, Meckling has failed. The guarantee has to hold while they are asleep. Section 6 reports where we fell short of that test.

## 1. The problem, with sources

| What happened | What it shows |
|---|---|
| **aixbt**, Mar 18, 2025: two queued malicious replies made the agent send 55.5 ETH (about $106k) from its wallet ([Cointelegraph](https://www.tradingview.com/news/cointelegraph:61f9396f2094b:0-hacker-breaks-into-ai-crypto-bot-aixbt-s-dashboard-to-snatch-55-eth/), [AI Incident Database #1003](https://incidentdatabase.ai/cite/1003/)) | The agent's key could send funds anywhere. |
| **Lobstar Wilde**, Feb 22, 2026: an agent sent 52.4M of its tokens to a stranger, $250k to $441k by different reports ([Cointelegraph](https://www.tradingview.com/news/cointelegraph:e25e7c3ff094b:0-ai-agent-sends-441k-in-tokens-after-decimal-error/)) | Same class: transfer power with no hard bound. |
| **Alpha Arena, Season 1**, Oct 18 to Nov 3, 2025: six models, $10k each, crypto perpetuals on Hyperliquid; four lost money, the worst 62.66% (as reported from [nof1.ai](https://nof1.ai)) | Agents trading badly, with no drawdown floor anywhere. |
| **Knight Capital**, Aug 1, 2012: a faulty algorithm lost more than $460M in about 45 minutes; the SEC later fined the firm $12M under Rule 15c3-5 | Pre-trade risk checks exist in regulated markets because this happens. |

## 2. Two objections, answered early

**"Why not use the exchange's own risk limits?"** Because they protect the exchange, not the person who funded the agent. A liquidation engine acts when a position nears bankruptcy, far past any backer's tolerance. And on Perpl, as on most perpetual venues, leverage is chosen per order by whoever signs the order. If the agent signs, the agent chooses.

**"Why not an off-chain policy engine?"** Because that is social trust. The backer cannot verify that the engine ran, that it ran the rules they agreed to, or that nobody switched it off. An on-chain mandate is a guarantee anyone can check: the rules are stored on Monad, every check runs inside the transaction, and every blocked attempt and breach is a public event.

## 3. How it works

An agent trades through a **MandateAccount**, a contract that trades on Perpl in its own name. Its owner (the backer, or a trader holding themselves to their own rules) can withdraw. The agent holds a **session key** that can only place, close and cancel orders. Each agent transaction runs in four steps, all in the same Monad transaction:

1. Measure the account: equity, total notional, each market's position.
2. Run the agent's calls against Perpl.
3. Measure the account again.
4. Check every rule against the result. If any rule fails, revert everything.

Rules come in two kinds:

- **Action rules** can be enforced before the fact: max leverage, max position per market, allowed markets, an order-rate limit, a cooldown after a loss, and optional price protection.
- **Market rules** can be broken by prices alone, with no trade: today, the drawdown floor. These cannot be prevented, only detected and insured. Anyone may call `flagBreach`; the contract recomputes the breach from live state, confirms Perpl's prices against independent Chainlink feeds, closes the positions and locks the account to closing only. After a dispute window, the operator's bond pays the backer the loss from peak, capped at the bond.

**The weak point, stated here:** a gap move can jump past the drawdown floor before any check runs. Meckling does not prevent that loss. The bond caps what the backer bears, up to its size; past the bond, the backer bears the rest. A backer should size their trust by the bond, the way a Hyperliquid depositor sizes it by the vault leader's required 5% stake (Hyperliquid docs, "For vault leaders").

Limits can also come from evidence: Meckling reads Nansen smart-money flows and positioning, sets a regime per market, and turns it into limits. The report is fingerprinted with keccak256 and the hash is stored on-chain, so anyone can fetch the report and check where each number came from.

## 4. What each rule guarantees

The full argument, rule by rule, is in [`rules-spec.md`](rules-spec.md). In brief:

| Rule | Guarantee | Evidence | Cannot prevent |
|---|---|---|---|
| No withdrawal by the agent | The session key can't transfer, withdraw, approve anyone but Perpl, or call any other contract | Invariants 2 and 3; unit tests | Bad trades inside the rules |
| Max leverage | No agent trade ends over the limit **and** grew exposure; a reducing trade is never blocked | **Proven** (Halmos) | Leverage rising from price moves |
| Max position per market | Same, per market | **Proven** | Growth from price moves |
| Allowed markets | Exposure only grows in allowed markets | Unit tests, invariant 1 | Losses inside allowed markets |
| Order rate | At most N order placements per fixed window of blocks | Unit tests, invariant 1 | A burst of up to 2N across a window edge |
| Cooldown after a loss | After a realized loss of at least X, no new exposure for N blocks | Unit tests, invariant 1 | Unrealized losses; fees are not counted |
| Price protection | No opening order priced more than p bps from Perpl's mark; no price means blocked | **Proven**, fuzzed, fork-tested on Perpl's live mark | Bad trades at fair prices; a manipulated mark |
| Drawdown floor (market rule) | A flag succeeds only if the chain recomputes the breach and the prices check out; payout is exactly the loss from peak, capped at the bond | **Proven** to match the keepers' formula; live on testnet twice | Loss before a flag, after the bond, or during the unwind |

Rules can only be tightened after creation, never loosened (invariant 4 and unit tests). That a tightened rule keeps its kind and stays valid is **proven** for every rule kind and every parameter.

## 5. Outcomes, with real numbers

Every row comes from our own runs on Monad testnet, except where it says otherwise.

| Scenario | Without a mandate | Under a mandate |
|---|---|---|
| The agent proposes 12.0× on a $200 account with a 1.5× limit | Fills | Reverted inside the transaction; nothing reached Perpl. It then scaled to 0.7× and filled for $143.47, inside every rule (first deployment, Sep 23) |
| A trader holding themselves to $250 per market tries a $220 long that would make their BTC position $268.92 | Fills | Blocked: "Your limit is $250." A $50 long filled normally |
| The account falls through its drawdown floor (first deployment) | The position runs | Flagged 6 blocks (about 2 seconds) after the keeper saw it, closed in the same transaction; after the 200-block dispute window the bond paid **$0.109218**, the exact loss from peak |
| A BTC long falls 0.98% against a 0.01% floor (current contracts, Oct 7) | The position runs | Flagged, closed, and the bond paid **0.989276 AUSD**, the exact loss. Section 6 explains why the loss was that large |
| A breach recovers before a keeper acts | n/a | The Chainlink CRE workflow checked the account and took no action: no false flag |
| A revenge trade right after a loss | Fills | Blocked for the cooldown window. **Unit-tested only** (a 150-block window in the test suite); no live testnet run yet |
| A live Claude agent trading on fresh Nansen data (smart money about 77% net short BTC and ETH, so risk-off, 1.5× max) | n/a | Opened a $100 BTC short and an $80 ETH short through all 8 rules, then held at 0.89× because there was no new signal |

**What enforcement costs on Monad**, measured with `eth_estimateGas` under Monad's own pricing, for the same $20 BTC order (`pnpm --filter agent measure:gas`):

| Path | Gas |
|---|---|
| Raw order straight to Perpl | 306,653 |
| Through a mandate, 4 rules, first contracts | 520,619 |
| Through a mandate, same 4 rules, current contracts | 499,277 |
| The live agent, 8 rules including price protection | 530,674 |

Monad charges storage by 128-slot page (MIP-8): 8,100 gas the first time a page is read. Laying each account's rules, mandate and monitors out to share pages cut an enforced trade from 9 pages to 3, and saved **21,342 gas** per trade, measured. Our first estimate, 48,600, was 2.3 times too high: it assumed six rules, and a four-rule account has one monitor page to save, not three.

## 6. Where it falls short

- **We failed our own test once.** The keeper that flags market breaches ran on a laptop. Its log jumps about 230,000 blocks, roughly 19 hours, while the machine slept, and in that time the staged breach grew from 0.03% to 0.98%. It was flagged within 17 blocks of the keeper seeing it again, and the bond paid the full loss. The payout was right; the timing was not. Action rules held the whole time, because they need no keeper. Market rules need one that never sleeps: an always-on host, or the CRE workflow deployed on Chainlink's network.
- **The arbiter is a trusted role.** See section 7.
- **Losses past the bond are the backer's.** The bond is a cap, not insurance of the whole account.
- **Unwind slippage is not paid back.** The payout is measured at the flag; slippage while closing is bounded but not reimbursed, and not yet measured.
- **Unaudited.** Unit tests, eight invariants over 16,384 random calls each, eight symbolic proofs and fork tests against real Perpl are not an audit. Four properties that multiply two unknowns are fuzzed, not proven ([`formal.md`](formal.md)).
- **Testnet.** Everything above ran on Monad testnet with test AUSD.

The full list of what broke while building, and what changed, is in [`postmortem.md`](postmortem.md).

## 7. Who pays when a flag is wrong

A wrong flag has three lines of defence, in order:

1. **It can't be faked.** `flagBreach` succeeds only if the contract recomputes the breach from live state and Perpl's marks agree with independent Chainlink feeds within a tolerance band (invariant 5). A keeper cannot assert a breach; it can only point at one.
2. **The operator can dispute.** For the dispute window after a flag, the operator can contest it. Nothing is paid while a dispute is open.
3. **An arbiter decides.** A designated arbiter resolves the dispute. If it withdraws the breach, the bond stays with the operator.

The honest gap is step 3: the arbiter is trusted today, and an arbiter that rules wrongly moves money wrongly. A decentralised resolution, for example one that accepts only the oracle evidence already checked in step 1, is future work. Until then, a backer and an operator are both trusting the arbiter, and they should know who it is before they sign.

## 8. Why Monad

- **Enforcement fits inside the trade.** Checking every rule in the agent's own transaction costs about 193k gas and no extra round trip, at 300 ms blocks.
- **Its storage pricing rewards careful layout,** and we built for it (section 5).
- **Its direction matches the product.** Monad's next phase names encrypted transactions until the order is final, application-specific sequencing, and private settlement domains with public liquidity ([Keone Hon, Oct 4, 2026](https://x.com/keoneHD/status/2106670836761633202); [Category Labs, Monad Private Settlement](https://www.category.xyz/monad-private-settlement)). A fund in a private domain can't publish its positions, but it can publish its mandate: its limits and breach record stay public and enforced, so "this fund never exceeds 2×" becomes checkable without revealing a position.
- **A clean record, with the authors' caveat.** A three-year study of sandwich attacks on protected order flow found 28.0M on Solana and attacks on Ethereum, Tron and Base, and none on Arbitrum or Monad ([No Place to Hide, arXiv 2609.28115](https://arxiv.org/abs/2609.28115)). The authors note Monad has been live for less than a year. Meckling is not MEV protection: the encrypted mempool is meant to protect an order before inclusion; Meckling constrains what an agent's included orders can do.
- **Quantum readiness.** Monad's [post-quantum roadmap](https://monad.xyz/blog/post-quantum-roadmap) puts user funds first, through a draft where an account's address stays fixed while its credentials change. Meckling refers to owner, agent key and backer only by address, so those accounts can move to post-quantum credentials without Meckling changing.

## 9. Agent keys

My Ledger N3xt paper, ["The Agent Key Lifecycle: Rotation and Revocation"](https://www.ledger.com/academy/series/n3xt/research-agent-key-lifecycle-rotation-revocation), found that rotation, delegation withdrawal and retirement of agent keys have no published mechanism. Meckling gives each an on-chain answer for one account: a session key with an expiry block, replaced in one transaction (the old key stops working in the same block, tested), revocable by the owner or operator, with its blast radius bounded by the rules.

## Appendix A: the math

All amounts are in collateral base units; bps are basis points (1/10,000).

- **Max leverage** (limit `L` bps): a trade fails when `postNotional × 10,000 > L × max(postEquity, 0)` **and** `postNotional > preNotional`.
- **Max position per market** (market `m`, limit `S`): fails when `postNotional(m) > S` **and** `postNotional(m) > preNotional(m)`.
- **Price protection** (limit `p` bps): distance `d = ⌈|price − mark| × 10,000 / mark⌉`, or unbounded if either is zero; an opening order fails when `d > p`. Rounding up means a price a hair over the limit never passes; proven never to under-report and at most 1 bps over.
- **Drawdown** (limit `D` bps, `peak` non-decreasing): breached when `max(equity, 0) × 10,000 < peak × (10,000 − D)`.
- **Payout** after the dispute window: `min(peak − equityAtFlag, bond)`.
- **Cooldown** (loss `X`, window `N` blocks): realized PnL of a trade is, for each market that shrank or flipped, the pre-trade unrealized PnL times the fraction closed; a realized loss of at least `X` starts a window of `N` blocks in which no trade may grow total notional.
- **Storage cost** (MIP-8): reads cost 8,100 gas for the first slot on a 128-slot page and 100 after that, so an enforced trade's storage cost is roughly `8,100 × pages + 100 × (slots − pages)`.

## Appendix B: references

- Securities and Exchange Commission, Rule 15c3-5 (Market Access Rule), adopted 2010; Knight Capital settlement, Oct 16, 2013.
- M. C. Jensen and W. H. Meckling, "Theory of the Firm: Managerial Behavior, Agency Costs and Ownership Structure", *Journal of Financial Economics*, 1976. Monitoring and bonding costs; Meckling is both, enforced by a contract.
- Incident sources: Cointelegraph and Decrypt on aixbt (Mar 18, 2025); AI Incident Database #1003; Cointelegraph on Lobstar Wilde (Feb 22, 2026); nof1.ai Alpha Arena Season 1.
- Hyperliquid docs, vault leaders' 5% requirement. Numerai docs, staking and payouts.
- Coinbase Developer Platform, Spend Permissions.
- Keone Hon, "A world computer worthy of the world's money", Oct 4, 2026.
- Category Labs, Monad Private Settlement (Oct 6, 2026).
- M. Ahmadvand, "Monad's post-quantum roadmap", Sep 28, 2026.
- "No Place to Hide: An Analysis on Protected Order Flow Sandwich Attacks", researchers from Category Labs, ETH Zurich, Flashbots and the University of Lisbon, arXiv 2609.28115, Sep 2026.
- Monad docs, opcode pricing (MIP-8 storage pages).
- D. Ayeku, "The Agent Key Lifecycle: Rotation and Revocation", Ledger N3xt, Sep 28, 2026.

Code, tests and every number above: [github.com/Demiladepy/meckling](https://github.com/Demiladepy/meckling). Checked claims and rejected ones: [`research.md`](research.md).
