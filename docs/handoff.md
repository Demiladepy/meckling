# Handoff — the live state

What exists right now, so a new session (or a different tool) can continue without rediscovering it. Pair with [plan.md](plan.md) for what is done and next.

Last updated: Sep 23, 2026 (after M2).

## Deployed contracts

**Monad testnet (chain 10143)** — `contracts/deployments/10143.json`

| Contract | Address |
|---|---|
| MandateRegistry | `0x9e6F25f2291AFD83d56fFf502670Dcc781E2A133` |
| MandateAccountFactory | `0x8F721E6B1367d471cFbA5fBdBbD714f208eB4F34` |
| PerplAdapter | `0xE8F999dECEB04FC84a9da540b577cB4C66ec69bE` |
| OracleGuard | `0xC395AFc52F37133091ec70907d859Fb0aeeDfAA2` |
| BondVault | `0xe6FB91056f899656d3700DbDb7BcE5680984686f` |
| Perpl exchange (theirs) | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` |
| Test AUSD (theirs) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |

**Redeployed Sep 23 with the M2 contracts**, so these replace the Sep 22 addresses; the Sep 22 demo mandate still lives on the old registry. Mainnet is **not** deployed yet. `contracts/deployments/local.json` is a local anvil fork and is gitignored.

## Live demo mandate (testnet)

| Thing | Value |
|---|---|
| MandateAccount | `0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A` |
| Backer / operator (deployer key) | `0xd55D2fAF138a0f5cDD77D973FE5e11E8e6d0faFA` |
| Agent session key | `0x44C0df5ee0A0534b2Cb898E82EBA747583F9388A` |
| Funded | 200 AUSD, deposited into Perpl |
| Report hash | `0xa4b2c54774d859c37c6013743a3dff3c72af8bb949932c369e21ef0bc317a873` |
| Limits (from live Nansen, risk-off) | 1.5x leverage · $160 BTC · $280 ETH · 10 orders/100 blocks · 600-block cooldown after $8 · 5% drawdown |

Proven live on testnet: a 12x trade reverted with `MandateViolation` (observed 11.3x vs the 1.5x limit), then a 0.7x trade filled on Perpl.

The backer address also holds ~9,600 test AUSD and ~4 MON, and has its own Perpl account (#680, 200 AUSD) created through Perpl's UI. That account is not used by Mandate.

## Live self-mandate account (testnet)

| Thing | Value |
|---|---|
| MandateAccount | `0xB81b1d54a76170dD0c5c4306f5f0437329afA53F` |
| Owner = operator (deployer key) | `0xd55D2fAF138a0f5cDD77D973FE5e11E8e6d0faFA` |
| Salt | `keccak256("mandate.self.v1")`, so the address follows from the passkey alone |
| Rules | BTC only · 3x · $250 per market · 10 orders/600 blocks |
| Funded | 100 AUSD, deposited into a fresh Perpl account |

Run on Sep 23 with the same contract calls `/trade` makes: a $50 long filled (`0x11e41a8e…`), a $220 long was blocked
("Blocked: this trade would make your BTC position $268.92. Your limit is $250."), and a $4,000 long never reached the
rules — Perpl rejected it first with `TakerOrderSettlementFailed`, which is why the screen now translates venue
errors too.

## Keys and environment

`.env` (gitignored, never commit) holds: `NANSEN_API_KEY`, `ANTHROPIC_API_KEY`, `DEPLOYER_PRIVATE_KEY`, `AGENT_SESSION_PRIVATE_KEY`, `AGENT_SESSION_ADDRESS`, `AGENT_OPERATOR_ADDRESS`. `.env.example` lists every variable. The deployer key was generated locally with `cast wallet new`; back it up in a password manager.

**Nansen credits are exhausted** on the free plan (endpoints return 403 `insufficient_credits`). Everything still works: the app labels reports "sample data" without a key, and the agent falls back to the stored report. Live evidence on camera needs more credits.

## Commands

```bash
# Testnet: create a fresh mandate from live Nansen evidence, funded, ready to trade
NETWORK=testnet FUND_USD=200 pnpm --filter agent setup:network

# Run the agent against it (DEMO_MODE=1 is the disclosed script: 12x blocked, then a trade inside the limits)
NETWORK=testnet MANDATE_ACCOUNT=0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A DEMO_MODE=1 AGENT_LOOP_BLOCKS=60 pnpm --filter agent start

# Watch it
NETWORK=testnet pnpm --filter app dev     # http://localhost:3000/agents/<account>

# Local fork of mainnet (real Perpl, no funds): three terminals
anvil --fork-url https://rpc.monad.xyz --block-time 1
cd contracts && DEPLOYMENT_NAME=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
pnpm --filter agent fork:sync && pnpm --filter agent setup:local
```

## Watch out

- **Nansen:** lowercase EVM addresses only; the free plan burns ~30 credits per underwriting.
- **Fork oracle:** an anvil fork freezes Perpl's price, so `fork:sync` must run or orders stop filling after 60 s.
- **Testnet feeds:** Chainlink on Monad testnet has BTC and ETH only, updating once a day. M2's oracle guard needs mainnet.
- **Session keys** can only trade. Withdrawals are owner-only, and `allowOrderForwarding` is refused by the adapter.
- **PT-AUSD on Curvance matures Oct 8**, inside the build window. Use earnAUSD for the M3 demo.
- **Envio ships no Windows binary.** Run codegen and dev from WSL or Docker; see indexer/README.md.
- **OracleGuard caps tolerance at 20%.** A local fork freezes the Chainlink feed while marks move, so deploy locally with GUARD_TOL_BPS=2000 GUARD_MAX_AGE_SEC=315360000.
- **Testnet has no MON or SOL feed**, so those markets can never be flagged there; BTC and ETH can.
- **RPC log limits:** `eth_getLogs` is capped at 100 blocks on the public RPC (and 15 req/sec) and at 1,000 blocks on the QuickNode endpoint now wired into `MONAD_TESTNET_RPC_URL`. Either way that is minutes of history at 0.31 s blocks, so track records come from the indexer and the app reads breaches from contract state. `LOG_RANGE_BLOCKS` sets the keeper chunk.
- **`.env` does not source cleanly in bash** (CRLF). Read keys with node or `--env-file`, not `. .env`.
- **Next dev can panic on a stale Turbopack cache** (`Every task must have a task type`). Fix: `rm -rf app/.next`.
