# Formal checks

Mandate's rules decide whether an agent's trade happens. Unit tests check chosen cases, and the invariant suite runs 65,536 random calls per invariant. This page covers the stronger layer on top: **symbolic proofs**, which hold for *every* input within the stated bounds, not just the inputs a fuzzer happened to try.

## What is proven (Halmos, every input)

`contracts/test/formal/RuleProofs.t.sol`, 8 proofs, all passing (Sep 30, Halmos 0.3.3, 1.45 s total).

| Proof | What it guarantees |
|---|---|
| `tighteningKeepsKindAndValidity` | A backer can only replace a rule with a valid rule of the same kind. Covers every kind and every parameter (PRD 7.8, invariant 4). |
| `maxLeverage_neverBlocksAReducingTrade` | A trade that doesn't grow exposure is never blocked, whatever equity did (D3). A price move can't trap a position. |
| `maxLeverage_blocksExactlyGrowthOverTheLimit` | The leverage rule blocks exactly the trades that end over the limit *and* grew exposure. |
| `maxNotional_neverBlocksAReducingTrade` | Same D3 guarantee for position size per market. |
| `maxNotional_blocksExactlyGrowthOverTheLimit` | The position-size rule blocks exactly the trades that end over the limit and grew that market. |
| `deviation_neverRevertsAndMissingPriceIsUnbounded` | No price the agent sends can make the price-protection check revert. An order with no price (or no mark) always counts as out of bounds. |
| `priceCollar_exactAndMonotone` | Price protection allows exactly the orders within the band, and a narrower band allows less. |
| `drawdown_matchesTheKeepers` | The on-chain drawdown condition is exactly the formula both keepers (Node and Chainlink CRE) compute off-chain, so a keeper can't flag what the chain would clear. |

Bounds: amounts below 2^64 collateral units (~1.8 × 10^13 AUSD), limits below 2^32 bps. The contracts never get near either.

## What is fuzzed, not proven

Four properties multiply two unknowns, and the solver doesn't finish them within 150 s, even with tighter bounds (2^40 for prices). They are fuzzed at 10,000 runs each in `contracts/test/RuleProperties.t.sol` and run on every `forge test`:

- the price-protection distance never rounds down and is at most 1 bps high;
- a stricter leverage limit allows no more than a looser one;
- equity at or above its peak is never a drawdown breach;
- a stricter drawdown limit flags at least what a looser one flags.

The last three follow in one line of arithmetic from the exact-formula proofs above. We still list them as fuzzed, because the solver didn't prove them.

## Running it

```bash
pip install halmos==0.3.3
cd contracts
FOUNDRY_OUT=out-halmos FOUNDRY_CACHE_PATH=cache-halmos halmos --contract RuleProofs --forge-build-out out-halmos --solver-command "python test/formal/yices_all_logic.py"
```

**Why the wrapper:** on Windows, the yices 2.6.4 build that Halmos uses never answers a query declared `(set-logic QF_AUFBV)`, even a trivially unsatisfiable one. The same query under `(set-logic ALL)` answers in milliseconds (reproduced Sep 30 on a 7-line query: `d ≤ s ≤ l` and `d > l`). `test/formal/yices_all_logic.py` changes only that line. Without it, every proof that touches memory "times out" on Windows, and the timeouts tell you nothing about the proof.

Halmos builds into its own `out-halmos/` because forge's cache ignores `--ast`: after `forge test`, the shared `out/` has no syntax trees and Halmos finds no tests. CI runs the same command on Linux (`formal` job), and `pnpm verify` runs it locally when Halmos is installed.
