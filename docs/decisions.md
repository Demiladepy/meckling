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
