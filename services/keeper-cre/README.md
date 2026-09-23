# keeper-cre

The Chainlink CRE keeper workflow (PRD 10.1). On every cron tick it reads each mandate account from Monad, decides whether a market rule is broken, and writes a signed report to `CreKeeperReceiver`, which calls `BondVault.flagBreach` (or `slash`).

`src/main.ts` is the workflow. It uses `@chainlink/cre-sdk` (v1.22): `CronCapability` for the trigger, `EVMClient.callContract` for reads, and `runtime.report()` + `evmClient.writeReport()` for the write, exactly as the SDK reference describes.

## Why this is safe to automate

`BondVault.flagBreach` is permissionless and recomputes the breach from live on-chain state, and `OracleGuard` must independently agree the marks are trustworthy. A wrong or forged report cannot invent a breach or redirect a payout; it just reverts. The receiver checks `msg.sender == forwarder` so only CRE-verified reports spend gas.

## Parity with the fallback relayer

Both keepers import `isDrawdownBreached` and `drawdownBps` from `@mandate/common`, which mirror `MaxDrawdownRule.sol`. The two keepers cannot disagree about what counts as a breach.

## Running it

The CRE CLI is a separate binary and needs a Chainlink CRE account, so these steps are for the owner:

1. Install the CLI (Windows): `irm https://app.chain.link/cre/install.ps1 | iex`, or download `cre_windows_amd64.zip` from [smartcontractkit/cre-cli releases](https://github.com/smartcontractkit/cre-cli/releases).
2. `cre login`, then `cre workflow supported-chains` to confirm the Monad chain selector name and the **Forwarder address** for your organization.
3. Deploy the receiver with that forwarder:

   ```bash
   cd contracts && forge create src/CreKeeperReceiver.sol:CreKeeperReceiver \
     --rpc-url monad_testnet --private-key $DEPLOYER_PRIVATE_KEY \
     --constructor-args <forwarder> <bondVault>
   ```

4. `cre init` a project, copy `src/main.ts` into it, and use `config.example.json` as the workflow config (fill in `receiver` and the chain selector name).
5. `cre workflow simulate` to run it locally, or `cre workflow deploy` to run it on CRE.

Until the workflow is deployed, `services/keeper-relayer` runs the same checks as a plain process, and the README says which one produced the demo.
