# Integrations: where each one stands

Checked Sep 26, 2026. The main target is **Monad Metropolis** (closes Oct 13, track: Onchain Finance & Trading).
Nansen Meridian (Sep 27) is a first submission to test the waters.

Status key: **Live** = proven on testnet · **Built** = code done, one step from live · **Blocked** = waiting on an
account or setting only the owner can change · **Not started**.

| Sponsor | Prize | Status | What exists | What's missing |
|---|---|---|---|---|
| **Perpl**: best use of API | $5,000 | **Live** | Agent and self-traders place real Perpl orders through mandate accounts; fills on testnet | Nothing for the bounty. A longer live trading run would strengthen it |
| **Perpl**: analytics / risk tool | $3,000 | **Built** | Risk screen `/risk/[account]`: leverage, equity vs peak, headroom, breaches, drawdown alert | Live indexer history (Envio) and Perpl's WebSocket feed, which the PRD promises |
| **Agora**: mobile trading app | $10,000 | **Built** | `/trade`: passkey sign-in, AUSD balance, orders, a rule blocking a trade. Proven on testnet with a key | **Test on a real phone with a passkey, installed as a PWA**, and record it on the phone |
| **Mera**: Mera-powered UX | $2,500 | **Built** | Every human account is a Mera passkey; no seed phrase anywhere | The same on-device test, plus a sign-up-to-first-trade video |
| **Chainlink**: CRE workflow | $3,000 | **Blocked** | Keeper workflow written against the real SDK; receiver contract tested; CLI v1.35.0 installed | Run `cre login` (owner). Then: deploy the receiver, run `cre workflow simulate`, save the logs |
| **Nansen**: best use (+ Meridian) | $5,000 pool | **Live** | Live underwriting → limits → fingerprint on-chain; agent reasoning quotes the report | Recording the video; enough credits on the day |
| **Envio**: best use | $1,000 | **Blocked** | Indexer written, app reads history from it and degrades without it | Owner: set the Envio deployment's **root folder to `indexer`**, then paste the GraphQL URL into `.env` |
| **Kimi** (optional) | $3,000 credits | **Not used** | Provider switch exists (`LLM_PROVIDER=kimi`) | Per the PRD, drop it unless the agent actually runs on Kimi |

Supporting pieces (no prize of their own):

| Piece | Status | Note |
|---|---|---|
| QuickNode RPC | **Live** | Testnet endpoint wired; token kept server-side behind `/api/rpc` |
| Tenderly | Waiting | Org requested; appears in a few days. For tracing in the M4 write-up |
| Curvance collateral (Fund screen) | **Not started** | M3 item; PT-AUSD matures Oct 8, so config-only |
| Chainlink data feeds | **Live** | Oracle guard checks Perpl's mark against the Chainlink feed before any breach is flagged |

## Highest-value next moves for Metropolis

1. **Phone test with a passkey**: unlocks Agora ($10k) and Mera ($2.5k) together, the largest prize pool. Only the
   owner can do this, on their own device.
2. **`cre login`**: five minutes of the owner's time turns Chainlink from blocked to live.
3. **Envio root folder**: one setting turns the indexer on, which also completes the Perpl risk tool.
4. **Perpl WebSocket on the Risk screen**: the last piece the PRD promises for the risk bounty.
