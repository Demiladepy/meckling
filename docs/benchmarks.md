# Benchmarks

Filled in M4 (PRD section 13). All numbers are measured, not estimated.

| Metric | Value | Method | Date |
|---|---|---|---|
| Gas per enforced trade | **520,808** (4 rules) vs **307,047** raw — enforcement adds **~214k gas, ~70%** | `eth_estimateGas` on Monad testnet (real Monad pricing, MIP-8 active): a $20 BTC IOC long through self-mandate account `0xB81b…A53F` vs the same order from an EOA with its own Perpl account. Different accounts, so treat as approximate. Six-rule figure still to measure | Sep 27 |
| Blocks from market breach to on-chain flag | TBD | Keeper logs over at least 20 induced breaches | |
| False flags | TBD | `flagBreach` calls reverted by OracleGuard | |
| Ultrafuzz findings | TBD | Found by severity / fixed | |

## Reference points from spike S1 (raw Perpl, mainnet fork)

- IOC open fill: ~153k gas
- Reduce-only IOC close: ~89k gas
- Cancel: ~24k gas
