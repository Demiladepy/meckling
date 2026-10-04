# Mandate's rules: what each guarantees, and what it cannot

This is the soundness argument behind Mandate. For every rule it states the guarantee, where the chain enforces it, the evidence that it holds, and, just as important, what it **cannot** prevent. A risk system that claims to stop everything is lying. This document says exactly where the edges are.

Code references are to `contracts/src`. "Proven" means a Halmos symbolic proof that holds for every input within the stated bounds (`docs/formal.md`). "Fuzzed" means a property test. "Invariant" means one of the eight PRD 7.8 invariants, checked over 16,384 random calls each on every CI run.

## 1. Model

An **account** (`MandateAccount`) holds collateral (AUSD) and trades on Perpl in its own name. Its **owner** (the backer, or a self-trader) can withdraw. An **agent** holds a **session key** that can only trade. A **mandate** in `MandateRegistry` holds up to 16 rules. Each rule is one of two kinds:

- **Action rules** are checked inside every agent transaction. If one fails, the whole transaction reverts and nothing reaches the exchange.
- **Market rules** can be broken by prices alone, with no trade at all. They can't be prevented, only detected and insured. A keeper (anyone) flags the breach; the account unwinds; after a dispute window, the operator's bond pays the backer.

Every execute measures the account's state before and after the agent's calls (equity, notional, per-market positions) through the venue adapter and checks the action rules against the *resulting* state. That is the core difference from call-level session-key policies, which see a call's parameters but not what the account looks like afterwards.

**Threat model.** We assume the agent may be wrong, manipulated or fully compromised: an attacker may hold its session key. We trust the owner's key, the contracts, Perpl's accounting and the oracle guard's price sources within their tolerance. Section 5 lists what follows if those assumptions fail.

## 2. Account-level guarantees (no rule needed)

| Guarantee | Enforced by | Evidence |
|---|---|---|
| The session key can't move funds out of the account. It may only approve AUSD to Perpl, create a Perpl account, deposit, add margin to a position, and place, close or cancel orders. Transfers, venue withdrawals, approvals to anyone else and calls to any other contract revert. | `MandateAccount._execute` target check; `PerplAdapter.inspectCall` selector allow-list | Invariants 2 and 3; `test_refusesTokenTransfer`, `test_refusesVenueWithdrawFromSessionKey`, `test_refusesApproveToOtherSpender`, `test_refusesOtherTargets` |
| The session key can't turn on Perpl's order forwarding, which would let orders bypass every rule. | `inspectCall` never allows `allowOrderForwarding` | `test_refusesOrderForwarding` |
| Opening orders must be immediate-or-cancel or fill-or-kill. No resting open orders, so exposure can't grow later outside a checked transaction. | `PerplAdapter._checkOrder` | `test_refusesRestingOpenOrders` |
| Session keys expire at a block, can be replaced at once by the owner (rotation), and can be revoked by the owner or the operator. | `setSessionKey`, `revokeSessionKey` | `test_expiredSessionKey`, `test_rotationRetiresTheOldKeyAtOnce`, `test_operatorCanRevokeButNotSet`, `test_sessionKeyCannotWithdraw` |
| Rules can only be tightened, never loosened, and only by the backer. A tightened rule keeps its kind and stays valid. | `MandateRegistry.tightenRule`, `RuleEngine.isTightening` | Invariant 4; **proven** (`tighteningKeepsKindAndValidity`) |
| After a breach is flagged, or the mandate is ended, the account only accepts reduce-only orders and cancels, permanently. | `closeOnly()`; `_checkOrder(closeOnly)` | Invariant 7 |

**What this means against real incidents.** aixbt (Mar 2025, 55.5 ETH) and Lobstar Wilde (Feb 2026) both lost funds because the agent's key could send them anywhere. A Mandate agent key cannot. See `docs/research.md` for sources.

## 3. Action rules

### Max leverage (`MaxLeverageRule`, p1 = limit in bps)

- **Guarantees.** After an agent transaction, total notional ÷ equity ≤ p1, **unless** the transaction did not increase total notional.
- **Why the exception.** If a price move pushes leverage over the limit, the agent must still be able to reduce. A rule that blocked reducing trades would trap the position (D3).
- **Evidence.** **Proven**: the rule blocks exactly the trades that end over the limit and grew notional, and never blocks a reducing trade. **Fuzzed**: a stricter limit allows no more than a looser one.
- **Cannot prevent.** Leverage rising above the limit through price moves alone. That is a market risk, and the drawdown rule covers it. Leverage is measured at Perpl's mark, so it's only as good as that mark.

### Max position size per market (`MaxNotionalPerMarketRule`, p1 = market, p2 = limit)

- **Guarantees.** After an agent transaction, notional in market p1 ≤ p2, unless that market's notional did not grow.
- **Evidence.** **Proven**: blocks exactly the trades that end over the limit and grew the market, and never blocks a reducing trade.
- **Cannot prevent.** Growth from price moves. It's per market, so it doesn't cap total exposure; max leverage does that.

### Allowed markets (`AllowedMarketsRule`, p1 = bitmap of market ids)

- **Guarantees.** Exposure can only grow in markets whose bit is set. Market ids ≥ 256 are never allowed. Positions in disallowed markets can always be reduced.
- **Evidence.** Unit tests; invariant 1.
- **Cannot prevent.** Losses inside allowed markets.

### Order rate limit (`OrderRateLimitRule`, p1 orders per p2 blocks)

- **Guarantees.** At most p1 order placements per fixed window of p2 blocks.
- **Evidence.** Unit tests; invariant 1.
- **Cannot prevent.** A burst of up to 2 × p1 orders around a window boundary (p1 at the end of one window, p1 at the start of the next). Windows are fixed, not sliding: cheaper on gas and simple to verify, at the cost of this edge. Cancels don't count.

### Loss cooldown (`LossCooldownRule`, loss ≥ p1 starts a p2-block cooldown)

- **Guarantees.** After a trade realizes a loss of at least p1, no transaction may increase total notional for p2 blocks ("no revenge trading"). Reducing is always allowed.
- **Evidence.** Unit tests; invariant 1.
- **Cannot prevent.** Losses that aren't realized (unrealized losses don't trigger it). Fees and slippage are left out of realized PnL, so a loss just under p1 plus fees won't trigger it. Many small losses below p1 never trigger it; the drawdown rule catches the cumulative effect.

### Price protection (`PriceCollarRule`, p1 = max distance from mark in bps; optional, D14)

- **Guarantees.** No order that opens or adds exposure may carry a limit price more than p1 bps from Perpl's mark. An order with no price, or placed while the mark is unavailable, counts as out of bounds and is blocked. Closes are never measured, so price protection can't trap a position.
- **Why it matters for a compromised agent.** An attacker holding the session key can't withdraw funds, but could try to bleed them by trading at absurd prices into the attacker's own resting orders. Price protection caps that at p1 bps per order, and the rate limit caps the number of orders.
- **Evidence.** **Proven**: the measurement never reverts and treats a missing price as unbounded; the rule allows exactly the distances within the band, and a narrower band allows less. **Fuzzed**: the distance never rounds down and is at most 1 bps high. **Fork-tested** against Perpl's live mainnet mark.
- **Cannot prevent.** Bad trades at fair prices. Manipulation of the mark itself (that's the oracle guard's job, section 4).

## 4. Market rule and the bond

### Max drawdown (`MaxDrawdownRule`, p1 = max fall from peak in bps)

- **Rule.** Breached when equity < peak × (1 − p1/10,000). The peak only goes up between breaches (invariant 8). Withdrawals lower it by the amount withdrawn, so taking money out is never a drawdown.
- **Not prevented, insured.** Prices alone can break it, so no transaction is reverted. Instead, anyone may call `BondVault.flagBreach`. It succeeds only if the contract recomputes the breach from live state **and** the oracle guard confirms Perpl's marks agree with independent Chainlink feeds within tolerance (invariant 5). On success the account unwinds its positions and enters close-only mode in the same transaction.
- **Payout.** After the dispute window, `slash` pays the backer **peak − equity at the flag, capped at the bond** (invariant 6: never more than the bond, never twice).
- **Evidence.** **Proven**: the on-chain breach condition is exactly the formula both keepers compute off-chain. **Fuzzed**: equity at or above the peak is never a breach; a stricter limit flags at least what a looser one flags. **Live**: on Monad testnet on Sep 23, a breach was flagged in 6 blocks and the bond paid $0.109218, the exact loss from peak.
- **Cannot guarantee.**
  - *Losses beyond the bond.* The payout is capped at the posted bond. The bond's size is the operator's credibility, and the backer should size their trust by it (Hyperliquid's comparable rule is a 5% leader stake; Numerai's is a per-round stake at risk).
  - *Losses after the flag.* The payout is measured at the flag. Slippage while unwinding is bounded by `unwindSlippageBps` but isn't paid back. Unwind slippage is not measured yet (benchmarks).
  - *Losses before anyone flags.* The rule is checked when someone calls `flagBreach`. If no keeper runs, nothing is flagged. Two independent keepers exist (a Node process and a Chainlink CRE workflow), and flagging is permissionless, but liveness is not a contract guarantee.
  - *A flag while prices disagree.* If Perpl's mark and Chainlink diverge beyond tolerance, `flagBreach` refuses. This prevents false flags at the cost of a delayed true one.

## 5. Trust assumptions, stated plainly

- **The arbiter.** An operator can dispute a breach within the window; a designated arbiter resolves it. Whoever holds that role can withdraw a breach, so the payout trusts the arbiter. A decentralised resolution (for example, the oracle guard's evidence alone) is future work.
- **Perpl.** Equity, positions and marks come from Perpl's own accounting. A Perpl failure or insolvency is outside what Mandate can enforce.
- **The oracle guard.** It trusts Chainlink feeds within a staleness bound and a tolerance band.
- **The owner's key.** The owner can withdraw when flat and replace the session key. A stolen owner key is game over, as for any wallet. Mera passkeys make that key a device-bound credential instead of a seed phrase.
- **Unaudited.** The contracts have unit tests, eight invariants, symbolic proofs and fork tests. None of that is an audit.

## 6. Key lifecycle

The author's Ledger N3xt paper, ["The Agent Key Lifecycle: Rotation and Revocation"](https://www.ledger.com/academy/series/n3xt/research-agent-key-lifecycle-rotation-revocation) (Demilade Ayeku, Sep 28, 2026), maps seven stages of an agent's signing key against published standards and finds rotation, delegation withdrawal and retirement without a published mechanism. Mandate gives each stage a concrete on-chain answer for one account:

| Stage | Mandate |
|---|---|
| Created and delegated | The owner sets one session key with an expiry block. Its authority is fixed by the call allow-list and the rules, not by the key. |
| Used | Every use is checked against the rules inside the transaction and logged on-chain. |
| Rotated | `setSessionKey` replaces the key in one transaction; the old key stops working in the same block. |
| Exposed | The blast radius is bounded by design: the key can't withdraw, and every trade still passes the rules. |
| Revoked | `revokeSessionKey`, by the owner or the operator. |
| Retired | The key expires at its block even if nobody remembers it. |

This lines up with the direction Monad states for its next phase: "flexible and upgradeable account authorization" as the top quantum-security priority, and Mera passkey accounts with signing sessions (Keone Hon, ["A world computer worthy of the world's money"](https://x.com/keoneHD/status/2106670836761633202), Oct 4, 2026). Because an agent's authority lives in the account and its rules rather than in the key, the key can change scheme without touching the rules.
