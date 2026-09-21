# keeper-cre

Chainlink CRE keeper workflow (PRD section 10.1), built in M2 with the CRE TypeScript SDK (v1.18+ for Monad mainnet, v1.19+ for testnet).

CRE writes go through a Forwarder to an `IReceiver` consumer (`onReport`), so M2 adds a `CreKeeperReceiver` that routes `(account, ruleIndex)` reports to `BondVault.flagBreach` and `slash`. See docs/spikes.md, S4.
