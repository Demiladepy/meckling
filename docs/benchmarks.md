# Benchmarks

Filled in M4 (PRD section 13). All numbers are measured, not estimated.

| Metric | Value | Method | Date |
|---|---|---|---|
| Gas per enforced trade | TBD | `execute` with all six rules minus the raw Perpl call | |
| Blocks from market breach to on-chain flag | TBD | Keeper logs over at least 20 induced breaches | |
| False flags | TBD | `flagBreach` calls reverted by OracleGuard | |
| Ultrafuzz findings | TBD | Found by severity / fixed | |

## Reference points from spike S1 (raw Perpl, mainnet fork)

- IOC open fill: ~153k gas
- Reduce-only IOC close: ~89k gas
- Cancel: ~24k gas
