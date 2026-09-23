# Ideas (out of scope)

Things that seemed useful but aren't in the PRD. The owner decides; the agent doesn't build these.

- **MON gas drip for new Mera users** (from S3): Mera accounts are plain EOAs with no sponsorship, so a first-time self-trader needs MON before they can create a MandateAccount. A small faucet or drip in the demo would smooth onboarding.
- **Perpl builder code attribution** (from S1): pass a Mandate builder code via `execOrdersV2` extensions for fee share or attribution.
- **Zerion builder plan** (Sep 23): a builder key is on hand (`ZERION_API_KEY` in `.env`). Zerion is not in the PRD's bounty table and nothing in the product needs a portfolio API — the Risk screen reads Perpl state and the Envio indexer. Plausible use later: a backer's cross-chain portfolio next to their mandates, or token metadata on the funding screen. Not built.
