# indexer

Envio HyperIndex (PRD 10.3). Monad full nodes serve no arbitrary historical state, so this is the only source for track records, equity curves, blocked attempts and breach timelines.

- `config.yaml` — Monad testnet (10143), HyperSync. `MandateAccount` has no address: accounts are created per backer, so the indexer registers each one from the factory's `AccountCreated` event.
- `schema.graphql` — `Account`, `Mandate`, `Rule`, `Execution`, `Violation`, `EquityPoint`, `Breach`, `Bond`.
- `src/EventHandlers.ts` — the handlers.

`Violation` records trades the mandate refused. A reverted transaction emits no events, so these come from `MandateAccount.preflight`, which simulates the trade and emits `ViolationAttempted` without executing (PRD 10.3).

## Running it

**Envio ships no Windows binary.** On Windows, run it inside WSL or Docker; `pnpm codegen` fails natively with `Cannot read properties of null (reading 'runCli')`.

```bash
# WSL (once)
mkdir -p ~/envio-cli && cd ~/envio-cli && npm i envio@3.12.1

# Codegen (validates config.yaml, schema.graphql and the handlers)
cd /mnt/c/.../mandate/indexer && ~/envio-cli/node_modules/.bin/envio codegen

# Run it (needs Docker for Postgres and Hasura)
~/envio-cli/node_modules/.bin/envio dev
```

`abis/` holds the ABIs copied from `contracts/out`. Regenerate them after changing a contract:

```bash
cd contracts && forge build
node -e 'const fs=require("fs");for(const [n,f] of Object.entries({MandateAccountFactory:"MandateAccountFactory.sol/MandateAccountFactory.json",MandateRegistry:"MandateRegistry.sol/MandateRegistry.json",MandateAccount:"MandateAccount.sol/MandateAccount.json",BondVault:"BondVault.sol/BondVault.json"}))fs.writeFileSync("indexer/abis/"+n+".json",JSON.stringify(JSON.parse(fs.readFileSync("contracts/out/"+f,"utf8")).abi,null,2))'
```

## Status

`envio codegen` passes and the handlers type-check against the generated types. A live run still needs Docker (or Envio's hosted service), which is the next step for the Risk screen and agent track records.
