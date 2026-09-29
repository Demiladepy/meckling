# Chainlink CRE — the keeper workflow, simulated and broadcast

Evidence for the Chainlink CRE bounty. Run on **Sep 29, 2026** with CRE CLI v1.35.0 against **Monad testnet**, logged in
as the owner's CRE organisation (deploy access not yet enabled, so the bounty is met by simulation).

## What the workflow orchestrates

One cron-triggered workflow (`services/keeper-cre/src/main.ts`) joins three independent sources into a single decision
that none of them can force alone:

| Source | Capability | What it contributes |
|---|---|---|
| **Monad** | `EVMClient.callContract` | Each account's rules, equity, open positions and drawdown monitor |
| **Chainlink price feeds** | via `OracleGuard.accountMarksTrusted` | Perpl's on-chain mark must sit within tolerance of the Chainlink feed |
| **Perpl's public API** (external) | `HTTPClient.sendRequest`, nodes agree by **median** | Perpl's off-chain mark for every market the account holds must agree with the on-chain mark |

Only when all three agree does the workflow write a signed report (`runtime.report` → `EVMClient.writeReport`) to
`CreKeeperReceiver`, which calls `BondVault.flagBreach`. `BondVault` recomputes the breach from chain state, so a wrong
report can only revert — it can never invent a breach.

## Setup

| Thing | Value |
|---|---|
| Chain | `monad-testnet`, selector `2183018362218727504` |
| CRE simulation forwarder | `0xB9F79d863261869B234c481D1f9A7af84AeAd192` |
| `CreKeeperReceiver` (trusts that forwarder) | `0x0ebECec6eA87650D9bBcc4F553d0f4713b09beAc` (deploy tx `0x06002119…05ba`) |
| Perpl API | `https://testnet.perpl.xyz/api/v1/pub/context` |
| Tolerance | `maxVenueDeviationBps: 100` |

The breach account `0xCF417EdF09c7a7247Ef99d9B0B71d753962d7fC8` was staged with `pnpm --filter agent stage:breach`: a
mandate with a 0.5% drawdown floor, 100 AUSD, a $40 BTC long, then the backer tightened the floor to 0.01% (tx
`0xa93d1223…8294`) — below the real drawdown Perpl's trading fee had already caused. Nothing but the workflow flagged it.

## The runs

**1. No breach yet** (`cre workflow simulate . -R . -T staging-settings`) — compiles to WASM, reads live testnet:

```
[SIMULATION] Running trigger trigger=cron-trigger@1.0.0
✓ Workflow Simulation Result:
"checked 2 account(s) at 1790690550, 0 action(s)"
```

**2. Breach present, dry run** — the HTTP call to Perpl runs and agrees; the report is built:

```
[USER LOG] 0xCF417EdF09c7a7247Ef99d9B0B71d753962d7fC8: flagging drawdown 7 bps over 1 (Perpl API agrees on 1 market(s)).
✓ Workflow Simulation Result:
"checked 3 account(s) at 1790691180, 1 action(s)"
```

**3. Broadcast** (`--broadcast`) — the report goes through the forwarder to the receiver on Monad testnet:

```
[USER LOG] 0xCF417EdF09c7a7247Ef99d9B0B71d753962d7fC8: flagging drawdown 3 bps over 1 (Perpl API agrees on 1 market(s)).
✓ Workflow Simulation Result:
"checked 3 account(s) at 1790691240, 1 action(s)"
```

## Verified on-chain after run 3

```
openBreachOf: 2
breach #1: block 66708349 · observed 3 bps · limit 1 bps · reporter 0x0ebECec6eA87650D9bBcc4F553d0f4713b09beAc
account breached/close-only: true
BreachFlagged tx: 0xa97b6ebda5c1b131f56c16f797272d4cc5e1b43ec600f75ce1a55ff85ecb795d (block 66708349)
```

The **reporter is the CRE receiver**: the flag came through Chainlink's forwarder, not from any key of ours. The account
is now close-only.

## Reproduce

```bash
cre login
pnpm --filter agent stage:breach                     # testnet only
cd services/keeper-cre
cre workflow simulate . -R . -T staging-settings --trigger-index 0
CRE_ETH_PRIVATE_KEY=<funded testnet key> cre workflow simulate . -R . -T staging-settings --trigger-index 0 --broadcast
```

## Findings along the way

- Javy (CRE's TypeScript-to-WASM compiler) rejects **exported functions that take parameters**; only `main` is exported.
- `writeReport` takes the receiver as a **hex address string**; base64 fails at runtime with "Invalid hex string".
- Perpl's minimum to open an account is **100 AUSD on testnet** and **10 AUSD on mainnet** (`getMinAccountOpenCNS()`).
