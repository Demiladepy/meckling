# Mandate

Mandate lets anyone fund an AI trading agent on Monad and makes it impossible for the agent to break the risk rules they set. Rules the agent could break are reverted inside its own trade. Rules the market breaks are caught on-chain and paid out from the operator's bond.

> **Status: M0 (spikes and scaffold).** Contracts are unaudited. The product spec is in [docs/PRD.md](docs/PRD.md), and spike results are in [docs/spikes.md](docs/spikes.md).

## Repository

```
contracts/        Foundry project (MandateRegistry, MandateAccount, BondVault, OracleGuard, venue adapters)
services/
  agent/          agent runtime (TypeScript)
  underwriter/    Nansen underwriting (TypeScript)
  keeper-cre/     Chainlink CRE keeper workflow
  keeper-relayer/ fallback relayer (same logic)
indexer/          Envio HyperIndex project
app/              Next.js PWA
docs/             PRD, spikes, benchmarks, security, ideas
```

## Run

Requirements: Foundry, Node 22+, pnpm 10.

```bash
git clone --recurse-submodules <repo>
cp .env.example .env
pnpm install
```

Contracts:

```bash
cd contracts && forge test
```

Fork tests against Monad mainnet (needs `MONAD_RPC_URL`):

```bash
cd contracts && FOUNDRY_PROFILE=fork forge test -vv
```

App:

```bash
pnpm --filter app dev
```

Nansen endpoint check (needs `NANSEN_API_KEY`):

```bash
pnpm --filter underwriter smoke
```
