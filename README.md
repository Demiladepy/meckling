# Mandate

> Nansen evidence doesn't inform a human decision here — it is compiled into limits a smart contract enforces, and the report that justified them is hashed on-chain with the mandate.

Fund an AI trading agent on Monad. Rules it could break are reverted inside its own trade. Rules the market breaks are caught on-chain and paid from the operator's bond.

**Live app:** _[paste Vercel URL before submit]_  
**Demo video (3 min):** _[paste link before submit]_  
**Network:** Monad testnet · **Spec:** [docs/PRD.md](docs/PRD.md) · **Nansen checklist:** [docs/submission-nansen.md](docs/submission-nansen.md)

> Contracts are unaudited. Use small funds only.

## Try it

1. **Create a mandate** (`/mandates/new`) — run live Nansen underwriting, see each limit name the signal that produced it, verify the report hash in the browser, approve with a Mera passkey.
2. **Watch the demo agent** (`/agents/0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A`) — paper (agent) / ink (chain) split screen on a funded testnet account.
3. **Trade under your own rules** (`/trade`) — self-mandate on a phone surface (no Nansen report; your limits only).

## What judges should see

| Proof | Detail |
|---|---|
| Live underwriting | Smart-money flows → regime → proposed limits; report keccak256 shown and verifiable |
| On-chain hash | Same `reportHash` in `MandateRegistry` as in the UI |
| Blocked trade | 12× attempt reverted with `MandateViolation` (observed 11.3× vs 1.5× limit); nothing changed on-chain |
| Breach + bond | Flagged in 6 blocks; bond paid the backer **$0.109218** (exact loss from peak). Flag `0x76f0f447…`, slash `0xacfd9371…` |
| Invariants | Eight PRD invariants hold over 16k fuzzed calls |

## Testnet addresses

| Contract / account | Address |
|---|---|
| MandateRegistry | `0x9e6F25f2291AFD83d56fFf502670Dcc781E2A133` |
| MandateAccountFactory | `0x8F721E6B1367d471cFbA5fBdBbD714f208eB4F34` |
| PerplAdapter | `0xE8F999dECEB04FC84a9da540b577cB4C66ec69bE` |
| Demo MandateAccount | `0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A` |
| Demo report hash | `0xa4b2c54774d859c37c6013743a3dff3c72af8bb949932c369e21ef0bc317a873` |

Full handoff: [docs/handoff.md](docs/handoff.md).

## How it works

1. **Underwrite.** Nansen smart-money evidence (perp positioning, net flows, holder concentration) sets a risk regime per market. A published table maps regime → limits. The full report is stored off-chain; its keccak256 is `reportHash` on the mandate.
2. **Approve.** The backer signs in with a Mera passkey and approves. A `MandateAccount` is created; the agent gets a session key that can only trade.
3. **Enforce.** Every agent trade goes through `MandateAccount.execute`. The account snapshots Perpl state, runs the orders, snapshots again, and reverts with `MandateViolation` if any action rule broke. Market rules (e.g. max drawdown) are flagged by a keeper; after the dispute window the bond pays the backer.

**What Nansen is not doing:** the agent's reasoning model is Claude (or Kimi, or a disclosed script). Nansen sets the limits. The chain enforces them.

## Disclosures

- **Demo mode is scripted.** With `DEMO_MODE=1` the agent follows a fixed script (proposes 12×, gets blocked, then trades inside limits). Without it, every decision comes from the model.
- **Sample data.** Without `NANSEN_API_KEY`, underwriting uses labelled fixtures (`source: "fixture"`). The app says "Sample data".
- **Local fork shims.** `fork:sync` and `/api/dev/fund` refuse to run on a real network.
- **Indexer.** Track-record history needs the Envio indexer; without it those strips hide themselves.
- **Unaudited.**

## Repository

```
contracts/        Foundry: MandateRegistry, MandateAccount(+Factory), rules, PerplAdapter
services/
  common/         ABIs, network config, Perpl encoding, rule copy
  underwriter/    Nansen → regime → limits → report hash
  agent/          runtime (Claude / Kimi / scripted demo)
  keeper-cre/     Chainlink CRE keeper
  keeper-relayer/ fallback relayer
indexer/          Envio HyperIndex
app/              Next.js PWA
docs/             PRD, plan, design, decisions, handoff
```

## Run locally

Requirements: Foundry, Node 22+, pnpm 10.

```bash
git clone --recurse-submodules <repo> && cd mandate
cp .env.example .env   # NANSEN_API_KEY, RPC, agent keys
pnpm install
NETWORK=testnet pnpm --filter app dev
```

Open `http://localhost:3000`. For a mainnet-fork stack against real Perpl, see the fork steps in [docs/handoff.md](docs/handoff.md).

## Tests

```bash
cd contracts && forge test
cd contracts && FOUNDRY_PROFILE=fork forge test -vv   # needs MONAD_RPC_URL
pnpm --filter @mandate/common test && pnpm --filter underwriter test
```
