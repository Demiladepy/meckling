# Benchmarks

Filled in M4 (PRD section 13). All numbers are measured, not estimated.

| Metric | Value | Method | Date |
|---|---|---|---|
| Gas per enforced trade | **520,808** (4 rules) vs **307,047** raw, enforcement adds **~214k gas, ~70%** | `eth_estimateGas` on Monad testnet (real Monad pricing, MIP-8 active): a $20 BTC IOC long through self-mandate account `0xB81b…A53F` vs the same order from an EOA with its own Perpl account. Different accounts, so treat as approximate. Six-rule figure still to measure | Sep 27 |
| Storage pages touched per enforced trade (MIP-8) | **3**, down from **9** (six rules) | `vm.record` + `vm.accesses` in `contracts/test/StoragePages.t.sol`, counting distinct 128-slot pages across MandateAccount, MandateRegistry and PerplAdapter. The per-rule monitors moved from a mapping to a fixed array on page 0, and each account's mandate and rules now sit on one page-aligned block | Sep 30 |
| Gas per enforced trade after the MIP-8 layout | **499,277** (4 rules) vs **520,619** for the identical account on the previous contracts: **−21,342 gas** measured. Raw order: **306,653**. Live agent with 8 rules (Nansen's 7 + price protection): **530,674** | `pnpm --filter agent measure:gas` on Monad testnet, block 68,816,686: `eth_estimateGas` for the same $20 BTC IOC long (limit mark + 0.5%) from an EOA, through the Sep 23 self-mandate account `0xB81b…A53F` (old contracts, 4 rules), through a twin with the same 4 rules on the new contracts (`0x1FF6…AC0c`), and through the live agent with its session key. Old vs twin isolates the storage layout. We had calculated ~48,600 from the 6-rule page count; a 4-rule account has one monitor, so the old layout touched about 3 more cold pages, not 6 (3 × 8,100 = 24,300), which matches the measurement | Oct 7 |
| Blocks from market breach to on-chain flag | TBD | Keeper logs over at least 20 induced breaches | |
| False flags | TBD | `flagBreach` calls reverted by OracleGuard | |
| Unwind slippage after a flag | TBD | Fill price of each unwind vs Perpl's mark at the flag, over the induced breaches. Not paid back by the bond (docs/rules-spec.md, section 4), so it needs a number | |
| Ultrafuzz findings | TBD | Found by severity / fixed | |

## Reference points from spike S1 (raw Perpl, mainnet fork)

- IOC open fill: ~153k gas
- Reduce-only IOC close: ~89k gas
- Cancel: ~24k gas
