# Owner setup: the accounts only you can create

Three things need an account or an install that I can't do from here. Each one is 10–20 minutes. Nothing else in the project is blocked on them: the fallback relayer already does the keeper's job, and the app reads chain state directly.

Keys go in `.env` (gitignored). Never paste them into a chat or a web form.

---

## 1. Envio: run the indexer (15 min, no Docker needed)

The indexer is written and `envio codegen` passes. It needs somewhere to run: Postgres and Hasura. Two routes.

### Route A: Envio's hosted service: **connected, deploys from the `envio` branch**

You don't need Docker, and it gives you a public GraphQL URL for the submission.

Done: the repo is connected, tier Development, deploy branch `envio`. That branch is pushed, so a build should be in **Deployment History**.

**How deploys work from here:** Envio only builds the `envio` branch, so it has to be kept level with `main`:

```bash
git checkout envio && git merge main && git push && git checkout main
```

When the build finishes, copy the GraphQL endpoint into `.env` as `ENVIO_GRAPHQL_URL` and tell me; I'll point the track records and Risk screen at it. If the build fails, send me the log, the indexer is standalone (its only dependency is `envio` 3.12.1), so it should install cleanly with **root folder** `indexer` and **config file** `config.yaml`.

Free tier: 3 indexers per org, 3 deployments each, deleted after 100k events, 5 GB, or 7 days idle. Fine for the hackathon; just redeploy if it sleeps.

**If the repo must be public for the app to connect,** that's fine to do now, the submission needs a public repo anyway, and no secrets are in git (I check every push).

### Route B: locally with Docker

1. Start **Docker Desktop** (installed on this machine; its daemon was off).
2. In WSL:

   ```bash
   mkdir -p ~/envio-cli && cd ~/envio-cli && npm i envio@3.12.1
   cd /mnt/c/Users/User/Desktop/summerofbitcoin/mandate/indexer
   ~/envio-cli/node_modules/.bin/envio dev
   ```

3. Hasura comes up on `http://localhost:8080`. Tell me and I'll wire the app to it.

Envio ships no Windows binary, which is why this runs through WSL.

---

## 2. Chainlink CRE: simulate or deploy the keeper workflow (20 min)

The workflow is written and type-checks against the real SDK. Running it needs a CRE account.

1. ~~Install the CLI~~ **Done.** `cre.exe` v1.35.0 is at `C:\Users\User\bin\cre.exe` (already on your PATH), downloaded from the official `smartcontractkit/cre-cli` release and verified against Chainlink's published SHA-256.
2. **You need to authenticate**, because every CRE command except `cre templates list` requires it (`init`, `simulate`, `supported-chains`). Either:
   - run `cre login` in a terminal and finish the browser flow, credentials are then stored on this machine and I can run the rest; or
   - paste a `CRE_API_KEY` from the CRE dashboard into `.env` for non-interactive use, which I prefer since it survives session restarts.
3. `cre workflow supported-chains`: copy two things and send them to me:
   - the **chain selector name** for Monad testnet (something like `monad-testnet`);
   - the **Forwarder address** for your organization.
4. I'll deploy `CreKeeperReceiver` with that forwarder, fill in `services/keeper-cre/config.example.json`, and run `cre workflow simulate`.

If CRE access doesn't come through, nothing breaks: the bounty accepts "build, simulate, or deploy", and the fallback relayer runs the identical checks. The README will say which one produced the demo.

---

## 3. The Metropolis perks

- **QuickNode**: **done.** The Monad testnet endpoint is in `.env` as `MONAD_TESTNET_RPC_URL` and verified: chain 10143, `eth_getLogs` up to 1,000 blocks (10x the public cap) and no rate throttle. Account discovery from the deployment block now takes 36 s. Mainnet still uses the public RPC; add a mainnet endpoint as `MONAD_RPC_URL` if you want the same there.
- **Tenderly**: requested through the Metropolis form. No confirmation email is sent; log in after a couple of days and the org will be there, named after the part of your email before the @. If you had no Tenderly account, one was created, set a password via "Forgot password". Access runs to **Nov 3**, past both deadlines. Used for tracing failed transactions in the M4 write-up (PRD 12); nothing is blocked on it.
- **Zerion**: builder key stored in `.env`. Not a targeted bounty and nothing in the product needs it, so it is logged in [ideas.md](ideas.md) rather than wired in.
- **Nansen**: working with your key. Each underwriting costs about 30 credits.
- **Alchemy**: only worth claiming if you would rather use their RPC than QuickNode.

---

## What I'm handling, so don't worry about these

- **The live testnet breach.** Done on Sep 23. Account `0xAdb15A72D8e01FC641ad2E218E060e434f2610e0`: the keeper flagged the breach in 6 blocks, the position unwound into close-only mode, and after the dispute window the bond paid the backer $0.109218, the exact loss from the equity peak. Flag `0x76f0f447…`, slash `0xacfd9371…`, and the split screen shows all of it.
- **CI.** Green again. It now runs `envio codegen` before typechecking, which also validates the indexer config and schema on every push.
