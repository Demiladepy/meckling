# Mandate

Mandate lets anyone fund an AI trading agent on Monad and makes it impossible for the agent to break the risk rules they set. Rules the agent could break are reverted inside its own trade. Rules the market breaks are caught on-chain and paid out from the operator's bond.

> **Status: M1 (enforcement core and Nansen underwriting).** Contracts are unaudited; use small funds only.
> Spec: [docs/PRD.md](docs/PRD.md) · Spikes: [docs/spikes.md](docs/spikes.md) · Design decisions: [docs/decisions.md](docs/decisions.md)

## How it works

1. **Underwrite.** Nansen smart-money evidence (Hyperliquid perp positioning, net flows, holder concentration) sets a risk regime per market. The regime maps to proposed limits through a published table. The full report is stored off-chain, and its keccak256 is written into the mandate as `reportHash`.
2. **Approve.** The backer signs in with a Mera passkey (no seed phrase, no extension) and approves the limits. A `MandateAccount` is created, and the mandate is written to `MandateRegistry`. The agent gets a session key that can only trade.
3. **Enforce.** Every agent trade goes through `MandateAccount.execute`. The account snapshots its Perpl state, runs the orders, snapshots again, and reverts with `MandateViolation` if any action rule broke. A blocked trade never lands on-chain.

Rules: max leverage, max position per market, allowed markets, order rate limit, loss cooldown (no revenge trading) and max drawdown (market rule; flagging and bonds arrive in M2).

## Repository

```
contracts/        Foundry: MandateRegistry, MandateAccount(+Factory), rule libraries, PerplAdapter
services/
  common/         shared ABIs, network config, Perpl encoding, rule copy
  underwriter/    Nansen underwriting (typed client + scoring + report hashing)
  agent/          agent runtime (Claude or Kimi; scripted demo mode)
  keeper-cre/     Chainlink CRE keeper workflow (M2)
  keeper-relayer/ fallback relayer (M2)
indexer/          Envio HyperIndex (M2)
app/              Next.js PWA: Create mandate, agent split screen
docs/             PRD, spikes, decisions, benchmarks, security
```

## Run it locally against real Perpl (mainnet fork)

Requirements: Foundry, Node 22+, pnpm 10.

```bash
git clone --recurse-submodules <repo> && cd mandate
cp .env.example .env
pnpm install
```

1. Fork Monad mainnet (real Perpl, real AUSD):

   ```bash
   anvil --fork-url https://rpc.monad.xyz --block-time 1
   ```

2. Deploy Mandate to the fork. The key is anvil's first dev key.

   ```bash
   cd contracts && DEPLOYMENT_NAME=local forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
   ```

3. Keep Perpl's prices fresh on the fork. This is fork-only: it mirrors live mainnet marks, because a fork freezes Perpl's oracle.

   ```bash
   pnpm --filter agent fork:sync
   ```

4. Underwrite, create a funded demo account, and run the agent:

   ```bash
   pnpm --filter agent setup:local
   ```

   Then run the command it prints (`NETWORK=local MANDATE_ACCOUNT=… pnpm --filter agent start`).

5. Watch it:

   ```bash
   pnpm --filter app dev
   ```

   Open `http://localhost:3000/agents/<account>` for the split screen, or `/mandates/new` to underwrite and approve a mandate with your own passkey.

## Tests

```bash
cd contracts && forge test
```

```bash
cd contracts && FOUNDRY_PROFILE=fork forge test -vv
```

```bash
pnpm --filter @mandate/common test && pnpm --filter underwriter test
```

- `forge test`: unit and invariant tests (invariants 1, 2, 3, 4, 7 and 8 from PRD 7.8).
- `FOUNDRY_PROFILE=fork forge test -vv`: the full stack against real Perpl on a mainnet fork (needs `MONAD_RPC_URL`).
- The `pnpm` line runs the TypeScript unit tests.

## Disclosures

- **Demo mode is scripted.** With `DEMO_MODE=1` the agent follows a fixed script. It proposes one trade at 12x equity (which the mandate blocks), then trades inside the limits, then hands over to the configured model. This makes the demo repeatable. Without `DEMO_MODE`, every decision comes from the model.
- **Sample data.** Without `NANSEN_API_KEY`, underwriting uses built-in sample responses. The report says `"source": "fixture"` and the app labels it "Sample data". Sample reports are for local testing only.
- **Local fork shims.** `fork:sync` and the app's `/api/dev/fund` act only on a local anvil fork: impersonating accounts, moving marks, and funding test accounts. Both refuse to run against a real network.
- **Unaudited.** No audit yet. Ultrafuzz runs in M4.
