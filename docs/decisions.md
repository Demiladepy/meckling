# Design decisions

Changes to, or refinements of, the PRD, with reasons. The owner approves anything here that changes behaviour a user can see.

## M1 (Sep 21, 2026)

**D1. Agent opens must be IOC or FOK. Resting orders are allowed only for closes.** *(Owner approved.)*
A resting open can be filled by another trader after `execute` has checked the rules, which would grow the position with no check. `PerplAdapter.inspectCall` refuses:
- open orders without `immediateOrCancel` or `fillOrKill`;
- `postOnly` opens;
- `Change` orders (type 6), which can grow a resting order.

**D2. Selector allowlist, not only a target allowlist (PRD 7.3).**
Perpl's `allowOrderForwarding(true)` would let orders placed through Perpl's API reach the chain without passing through `execute`. `MandateAccount` accepts only these calls:
- `approve(exchange)` on the collateral token;
- `createAccount`, `depositCollateral` and `increasePositionCollateral`;
- `execOrder(s)` with the order types from D1.

`withdrawCollateral` goes only through the owner's `withdrawFromVenue`.

**D3. Action rules revert only if the trade grows the limited exposure (refines invariant 1).**
The market can push leverage or notional above a limit without the agent doing anything. If every trade then reverted, the account could never reduce risk. So:
- `MaxLeverage`, `MaxNotionalPerMarket` and `AllowedMarkets` revert when the post-trade value is over the limit **and** the trade increased the relevant notional.
- `OrderRateLimit` counts every order placement (opens and closes; cancels don't count).
- `LossCooldown` blocks only trades that increase total notional.

Invariant 1 is tested in this form.

**D4. Close-only mode skips rule checks.**
The adapter already admits only exposure-reducing calls in close-only mode, and a rule such as `OrderRateLimit` must never block an exit. Monitors (the equity peak) still update.

**D5. `withdraw(amount)` always pays the owner (PRD 7.3 had `withdraw(amount, to)`).**
Invariant 2 allows tokens to go only to the owner/backer. A free `to` parameter would add a path to check and gain nothing. Withdrawals lower the drawdown peak by the amount withdrawn, so taking money out is never counted as a drawdown. Invariant 8 is tested as "non-decreasing except on withdrawal".

**D6. The owner is the capital holder. The operator can only revoke the session key.**
The backer (agent mode) or the trader (self-mandate) owns the account, sets the session key, and is the only one who can withdraw. The operator runs the agent and can revoke its own key. Operator consent to the mandate comes with the bond in M2.

**D7. One mandate per account, for the account's lifetime.**
Loosening means a new account and a new mandate (PRD 7.2). Deactivation is final and puts the account in close-only mode.

**D8. IVenue changes (PRD 7.1).**
- `AccountState` carries the list of open markets.
- `inspectCall` validates each call (D2).
- `encodePlaceOrder` and `encodeCancel` are dropped: the agent builds Perpl calldata off-chain.
- `encodeCloseAll` moves to M2 with `unwind`.

**D9. Equity definition.**
Equity is idle AUSD in the account + Perpl `balanceCNS + lockedBalanceCNS` + Σ over positions (`depositCNS + deltaPnlCNS + premiumPnlCNS`). Unrealized PnL is delta plus funding, per the dex-sdk. The mainnet fork test checks it against Perpl's own accounting (fees are the only difference).

**D10. Realized loss for `LossCooldown`.**
Realized loss is the pre-trade unrealized PnL times the fraction of the position closed, summed over markets that shrank or flipped. Fees and slippage are excluded. This keeps the rule computable from two snapshots with no venue event parsing.

**D11. Curvance collateral: one adapter per backer, capped with Curvance's own valuation.** (Sep 27)
`CurvanceCollateralAdapter` holds one backer's Curvance position in its own name, so one backer's health never
depends on another's. It never prices anything itself: after every borrow and collateral withdrawal it reads
`MarketManager.statusOf` and reverts unless `debt ≤ maxDebt × maxUseBps / 10,000`, with `maxUseBps ≤ 5,000` (PRD 7.7's
"at most 50% of Curvance's maximum"). Anyone may repay; only the backer may add, borrow or withdraw. The PRD's keeper
rule `CollateralHealth` is **not built yet**: it needs a new market-rule kind plus a remedy for when health falls
(unwind and repay), which crosses `BondVault` and the keeper. For earnAUSD against AUSD debt the price drift it would
catch is small, and the adapter already enforces the cap at every action. Owner to decide whether it is worth the time.

**D12. Loosening a limit (queued, not built).** (Sep 27, from the owner's research)
Rules can only tighten today. Proposed: `proposeLoosen` in `MandateRegistry`, requiring both backer and operator, taking
effect only after a timelock of N blocks; tightening stays instant and unilateral. New invariant: a loosening never
takes effect before its timelock. Agents may emit `RequestLimitChange` with their reasoning for the backer's screen.
Queued until the original plan is finished, per the owner.

**D13. Agent memory encrypted to the backer's passkey (the Mera bounty feature).** (Sep 29, designed; to build)
The Mera bounty rewards PRF uses that are *not* a wallet. The agent's reasoning reveals the operator's strategy and the
backer's positions, yet today it is public. Design, from reading `@category-labs/mera` 0.2.0's own types:
- **A second, isolated PRF namespace per agent.** `getPasskeyPrfOutput({ prfSalt })` with
  `prfSalt = SHA-256("mandate/agent-memory/v1/" + mandateAccount)`. The wallet keeps Mera's default salt, so the memory
  key is unlinkable to the account key, and each agent gets its own.
- **Derivation, then encryption, kept separate.** HKDF-SHA-256 over that PRF output (info `mandate.memory.x25519.v1`)
  gives an X25519 key pair, deterministically. Nothing is stored; the backer's browser publishes only the public key.
- **Why not Mera's secret vault:** a vault encrypts with an AES key derived from the PRF output, so encrypting needs
  the passkey present. The agent runs on a server without it. So the agent encrypts each record to the backer's public
  key (ephemeral X25519 → HKDF → AES-256-GCM), and any host can store the ciphertext.
- **Cross-device test:** the same passkey on a second device re-derives the same key pair and decrypts the same records.
- Opt-in per mandate ("private reasoning"). The public screen keeps showing verdicts; reasoning shows as encrypted
  until the backer unlocks it with the passkey.

**D14. Price collar rule (candidate — needs the owner's yes).** (Sep 29)
SEC Rule 15c3-5 rejects "erroneous orders" on price as well as size (`docs/research.md`). Mandate limits size and
capital but not price. A `PriceCollar` action rule would revert any order whose limit price sits more than N bps from
the OracleGuard-trusted mark — the Knight Capital failure mode. It is outside the PRD, so it is not built until the owner
approves (CLAUDE.md rule 1).
