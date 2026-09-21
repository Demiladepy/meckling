# Day-0 spikes

Run on Sep 21, 2026. Chain state was read at mainnet block ~106,715,000 and testnet block ~64,414,000.

| Spike | Result | Decision |
|---|---|---|
| S1 Perpl from a contract | **Pass** (mainnet fork test) | `MandateAccount` calls the exchange directly. No fallback. |
| S2 Curvance AUSD borrow | **Pass** | Build the adapter in M3. Use earnAUSD (or PT-AUSD, see the maturity caveat). |
| S3 Mera passkeys | **Pass, with one open item** | Mera EOAs own `MandateAccount`s. Test standalone PWA mode on a real iPhone and Android device early in M3. |
| S4 Chainlink CRE on Monad | **Pass on paper** | CRE lists Monad mainnet and testnet with EVM write. Confirm with `cre workflow supported-chains` once the owner's CRE account exists. The relayer fallback stays. |
| S5 Price sources | **Pass** | OracleGuard compares Perpl's mark against a Chainlink Data Feed. Perpl's own Data Streams oracle price is recorded as a third reference. |
| S6 Nansen API | **Pass (verified live, Sep 21)** | All four endpoints respond on the owner's key at 5 credits per call. Nansen matches EVM token addresses in lowercase only. |
| S7 Envio on Monad | **Pass** | HyperSync supports 143 and 10143. Perpl events can be indexed from its ABI. |

---

## S1: Can a smart contract trade on Perpl?

**Answer: yes.** Perpl keys accounts by `msg.sender`. Any contract can call `createAccount`, `depositCollateral` and `execOrders` for itself. Whitelisting is off on both networks (`whitelistingEnabled() == false`).

**Evidence:** `contracts/test/fork/PerplContractAccount.fork.t.sol`, run against a mainnet fork (`FOUNDRY_PROFILE=fork forge test`). A bare `ProbeAccount` contract:

1. Created Perpl account #5312 with 100 AUSD. `getAccountByAddr(probe).accountAddr == probe`.
2. Deposited another 50 AUSD.
3. Placed a post-only BTC bid 20% below mark (order 27, owned by account 5312), then cancelled it (`orderType = 4`).
4. Opened a 0.0002 BTC long at 2x with an IOC order. It filled at 85,002.4, and the position held `depositCNS` = 8.50 AUSD.
5. Closed the long reduce-only (`orderType = 2`, IOC). Position size went to 0.

Gas seen in the trace: IOC open fill about 153k, reduce-only close about 89k, cancel about 24k, resting post about 60k (all including Perpl's proxy hop).

### Exchange facts (v1.7.4 mainnet, v1.7.5 testnet)

- The ABI comes from `github.com/PerplFoundation/dex-sdk` at `crates/sdk/abi/dex/Exchange.json` (commit `5b5be46`). A copy is at `contracts/abi/PerplExchange.json`, and the subset we use is in `contracts/src/venues/IPerplExchange.sol`.
- **Proxy:** ERC1967. Mainnet implementation is `0xF7df187620C81deEe0833589509F41F95886Cd33`.
- **Order entry:** `execOrders(OrderDesc[] descs, bool revertOnFail)`.
  - `orderType`: 0 OpenLong, 1 OpenShort, 2 CloseLong (reduce-only), 3 CloseShort (reduce-only), 4 Cancel, 5 IncreasePositionCollateral, 6 Change.
  - Leverage is per order in hundredths (`leverageHdths`, 300 = 3x).
  - There is no reduce-only flag; the close order types are reduce-only.
- **Margin is isolated per position.** Each position has its own `depositCNS`. Free collateral is `AccountInfo.balanceCNS`, and `lockedBalanceCNS` backs resting orders.
  - Equity for the rules is `balanceCNS + lockedBalanceCNS + Σ_perps (depositCNS + pnlCNS)` (funding is already in `pnlCNS`; confirm in M1 with a test).
- **Positions:** `getPosition(perpId, accountId)` returns `(PositionInfo, markPricePNS, markPriceValid)`.
  - `positionType`: 0 long, 1 short.
  - `AccountInfo.positions` is a 4×uint256 bitmap of perps with open positions. This gives `AllowedMarkets` and `closeAll` their market list without a loop over every market.
- **Units:** collateral (AUSD) has 6 decimals. Price and lot decimals are per perp (from `getPerpetualInfo`).
  - Mainnet BTC: priceDecimals 1, lotDecimals 5.
  - Mainnet MON: priceDecimals 6, lotDecimals 0.
  - Mainnet ETH: priceDecimals 2, lotDecimals 3.
- **Minimum to open an account:** mainnet 10 AUSD, testnet 100 test tokens (`getMinAccountOpenCNS`).
- **Testnet collateral token** is `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, not AUSD. Read it from `getExchangeInfo()` at runtime.
- **Market IDs differ per network.** Store per-network maps.

  | Market | Mainnet | Testnet |
  |---|---|---|
  | BTC | 1 | 16 |
  | ETH | 20 | 32 |
  | MON | 10 | 64 |
  | SOL | 31 | 48 |

- **Rate limits** apply to the WebSocket API only: trading 120/min on mainnet and 60/min on testnet, 4 connections per wallet; market data 10 req/min. On-chain `execOrders` has no API rate limit.
- **Builder codes:** optional attribution via `execOrderV2`/`execOrdersV2` `extension` bytes (`docs.perpl.xyz/.../api/builder-codes`). Not required.
- **Testing note:** AUSD packs balances, so forge `deal()` can't write them. Fork tests fund by pranking a large holder (the exchange holds about 3.9M AUSD).

### Security constraints this imposes on `MandateAccount` (M1)

1. **Selector allowlist, not only a target allowlist.** The exchange exposes `allowOrderForwarding(bool)`. If a session key could call it, orders submitted through Perpl's API would be forwarded on-chain via `execFwdPositionOps`, bypassing `execute` and every rule.
   - `MandateAccount` must never call `allowOrderForwarding`.
   - Session keys may call only `execOrders`/`execOrder` (with an order-type check), `depositCollateral` and `increasePositionCollateral`.
   - `withdrawCollateral` is owner/backer only, via `withdraw`.
2. **Token approvals:** the only allowed collateral-token call is `approve(exchange, x)`.
3. **`orderType` 6 (Change)** can raise size or leverage on a resting order. Treat it like an open, since post-trade checks see the resulting state. It is disallowed in close-only mode.
4. **Resting orders** don't change the position until matched, and another trader's fill can grow the position without `execute` running.
   - `MaxNotionalPerMarket` and `MaxLeverage` must count worst-case resting size, or open orders must be restricted to IOC/FOK.
   - **M1 decision (owner to confirm):** agent opens must be IOC or FOK. Resting orders are allowed only for close types.
5. **ADL, liquidation and funding** can change state outside `execute`. These are market-rule territory (drawdown), which matches the PRD.

**Oracle facts (feeds S5):** `getPerpetualInfo(perpId)` exposes `markPNS`, `lastPNS` and `oraclePNS`. The oracle price comes from Chainlink Data Streams, verified on-chain through the exchange's `verifierProxy` (`linkFeedId` per perp, `refPriceMaxAgeSec = 60`, `priceTolPer100K = 5000`).

---

## S2: Curvance — borrow AUSD against yield-bearing collateral

**Answer: yes, several isolated markets on Monad mainnet.** Read on-chain via `MarketManager.collConfig(cToken)`, which returns `(collRatio, collReqSoft, collReqHard)` in bps. The maximum `collRatio` is 9750.

| Market (MarketManager) | Collateral cToken | collRatio | Soft / hard liq req | Collateral cap | AUSD available to borrow* |
|---|---|---|---|---|---|
| PT-AUSD-8OCT2026 (`0xdDd5681f…Ec2e`) | `0x6eD14BA7…3bF8` | 95.00% | 103.0% / 102.5% | 30M | ~1,035,140 |
| earnAUSD (`0xd6365555…8545`) | `0x852FF1EC…263D` | 92.00% | 104.5% / 104.0% | 40M | ~96,833 |
| hyAUSD (`0x120E3ef1…cE6a`) | `0xbaAD847D…cA30` | 90.00% | 105.0% / 104.0% | 20M | ~7,008 |
| sAUSD (`0xBBE7A3c4…41Eb`) | `0x84C5aF20…D9Ac` | 95.00% | 103.0% / 102.5% | 30M | ~942 |

\* AUSD held by the market's borrowable cToken at the time of reading.

- Also available: WMON|AUSD, syzUSD, wsrUSD, vUSD, savUSD, muBOND, loAZND and YZM markets.
- The SDK is `github.com/curvance-web/sdk` (TypeScript, ethers v6). Addresses are in `src/contracts/monad-mainnet.json`.
- ProtocolReader is `0x55C7c1fe1DACB014aD3b21951728B5E580662268`.

**Decision:**
- The adapter borrows at no more than 50% of `collRatio`, as the PRD requires. For earnAUSD that means at most 46% LTV.
- **Caveat:** PT-AUSD-8OCT2026 matures **Oct 8, 2026**, inside our M3/M4 window. Default the demo to **earnAUSD** and keep PT-AUSD as a config option.
- Both are mainnet-only. The Curvance SDK has no Monad testnet deployment, so `CurvanceCollateralAdapter` is tested by mainnet fork.

---

## S3: Mera passkey accounts

Source: `docs.monad.xyz/guides/mera`, `mera.category.xyz/authenticator-support/`.

- Package: `@category-labs/mera` (plus `@category-labs/mera/viem`), with `@scure/bip32` and `@scure/bip39`.
- Flow:
  1. `createPasskeyWithPrfOutput({rp, user})` returns `{credentialId, prfOutput}`. Store the credential in localStorage.
  2. `getPasskeyPrfOutput({rpId, credential})` retrieves it on later visits.
  3. Derive with BIP-39/44 (`m/44'/60'/0'/0/i`), then `createSecp256k1SigningSession({privateKey})` and pass it through `toViemAccount(session)` to get a viem wallet client.
- **Accounts are plain EOAs.** There is nothing to deploy and no bundler. They need MON for gas, and there is no built-in sponsorship.
  - For us, the Mera EOA is the `owner` (self-trader) or the `backer` of a `MandateAccount`.
  - Fund new users with a small MON drip in the demo (an idea, not scope; logged in `ideas.md`).
- **Signing:** use a per-transaction session for backer actions and a held session for the self-trader's trading screen. Call `session.end()` on lock and blur.
- **PRF support:**
  - iOS 18+: Safari and Chrome with iCloud Keychain.
  - Android: Chrome with Google Password Manager.
  - Desktop Chrome: only with Google Password Manager. Local-profile passkeys throw `PRF_UNAVAILABLE`.
- **Open item:** installed-PWA (standalone) mode isn't documented. This needs an on-device test (iOS Safari "Add to Home Screen" and Android Chrome install) early in M3, or sooner. If standalone fails, the fallback is the in-browser PWA (same URL, not installed). That still satisfies "PWA accepted" but needs the owner's sign-off.

---

## S4: Chainlink CRE on Monad

Source: `docs.chain.link/cre/supported-networks-ts`.

- Monad mainnet: CLI v1.29.0+, Go SDK v1.17.0+, TS SDK v1.18.0+.
- Monad testnet: CLI v1.30.0+, Go SDK v1.19.0+, TS SDK v1.19.0+.
- EVM read and write are supported on both.
- **SDK: TypeScript** (matches our services stack).
- **Write model:** the workflow can't send arbitrary transactions.
  1. It produces a signed report (`runtime.report()`).
  2. `evmClient.writeReport()` sends it to the chain's **Forwarder**, which calls `onReport(metadata, report)` on a consumer contract implementing `IReceiver`.
- **Design impact (M2):** add a small `CreKeeperReceiver` consumer.
  - It checks the forwarder address and workflow ID.
  - It decodes `(account, ruleIndex)` and calls `BondVault.flagBreach` or `slash`.
  - Because `flagBreach` verifies the breach on-chain, the receiver needs no trust. It's a routing shim, and the relayer fallback calls `BondVault` directly.
- **To confirm once the owner has a CRE account:** `cre workflow supported-chains` (the Monad forwarder address and chain name for our org) and whether deploying is gated behind early access. Simulation (`cre workflow simulate`) works locally regardless and is accepted by the bounty.

---

## S5: Price sources

- **Perpl mark:** on-chain via `getPosition(...)` (`markPricePNS`, `markPriceValid`) or `getPerpetualInfo(perpId).markPNS`. Also `lastPNS` and `oraclePNS` (Chainlink Data Streams, verified on-chain, `oracleTimestampSec`).
- **Chainlink Data Feeds on Monad mainnet** (proxy addresses from `reference-data-directory.vercel.app/feeds-monad-mainnet.json`). All updated within 20 s of reading, 3600 s heartbeat:

  | Pair | 8-decimal proxy (deviation) | 18-decimal proxy (deviation) |
  |---|---|---|
  | BTC/USD | `0xc1d4C3331635184fA4C3c22fb92211B2Ac9E0546` (0.02%) | `0x187efD8ba8483105f2735740D956f7CD23723deC` (0.05%) |
  | ETH/USD | `0x1B1414782B859871781bA3E4B0979b9ca57A0A04` (0.05%) | `0x38057D0458ca56068e1A57E62D3874cA129A7A78` |
  | MON/USD | `0xBcD78f76005B7515837af6b50c7C52BCf73822fb` (0.02%) | `0xFB504aD06Ab5E6c63FE0A46FEa245214838E8015` |
  | SOL/USD | `0x16F8008c3e89f62e5e2b909Ce70999370D38F4F2` | — |
  | AUSD/USD | `0x91D9c75fe73e25f22d9F5e0C6a2a5eC48B6bFBeB`, `0xE20751C7B5867bCBef815ffc1b284c3f412a9e13` | — |

- **Monad testnet feeds:** BTC/USD `0x12C0F44368a02081ce58a936d1C1F606BB301715` and ETH/USD `0x5c8c8482f064049248F86D9F4aFa4B1f2F5b6d31`, both live but with a 24 h heartbeat and 0.5% deviation. There is **no MON/USD on testnet**.
- **OracleGuard design:** `markIsTrusted(perpId)` requires all three of:
  - Perpl `markPriceValid`.
  - `|mark − chainlinkFeed| ≤ tolBps` (default 50 bps).
  - Feed `updatedAt` within `maxAgeSec`, plus a `maxAgeBlocks` bound on our own last-seen round.

  Units: normalize both sides to 1e18.
- **On testnet**, the 24 h heartbeat and 0.5% deviation make a 50 bps band against the feed unreliable. Testnet config uses Perpl's `oraclePNS` (Data Streams, 60 s max age) as the second source. That's another reason to demo market rules on mainnet (open question 3).

---

## S6: Nansen API

Source: `docs.nansen.ai`. Base `https://api.nansen.ai/api/v1`, header `apikey: <key>`. Every endpoint is a POST with JSON `{..., filters, pagination:{page, per_page≤1000}, order_by:[{field, direction}]}`. The credit cost comes back in the `X-Nansen-Credits-Cost` header.

| Endpoint | Use in underwriting |
|---|---|
| `POST /smart-money/netflow` (`chains[]`, filter `token_address`) | Smart-money net flow 1h/24h/7d/30d USD for the underlying (MON on `monad`; wrapped BTC/ETH on `ethereum`) |
| `POST /tgm/holders` (`chain`, `token_address`, `label_type`) | Holder concentration (`ownership_percentage`), smart-money balance changes |
| `POST /tgm/perp-positions` (`token_symbol`, `label_type: smart_money`) | Smart-money perp positioning on Hyperliquid (side, leverage, value, uPnL). This is the most direct signal for a perp mandate. |
| `POST /smart-money/pnl-leaderboard` (`chains[]`, `timeframe`) | Leaders' PnL, used to weight the positioning signal |

- **Monad is supported** (`monad`) for smart-money, Token God Mode and Profiler endpoints. Netflow covers a rolling 30 days only.
- **Verified live (Sep 21, owner's key, CLI reports "Plan: free").** `pnpm --filter underwriter smoke` got an OK from all four endpoints at 5 credits per call. One live BTC+ETH underwriting cost 30 credits. Findings:
  - **The netflow `token_address` filter only matches lowercase addresses.** A checksummed WBTC address returned no rows; lowercase returned the WBTC row. The underwriter now lowercases EVM addresses and sets `include_native_tokens` and `include_stablecoins`.
  - Perp positions come back with `leverage` as uppercase strings such as "5X". `parseFloat` handles them.
  - Live result on Sep 21: smart money on Hyperliquid was 66% net short BTC (100 traders, 14.0x average leverage) and 71% net short ETH (9.4x). Both markets are risk-off, so the mandate is 1.5x max leverage and $400 per market on a $1,000 base.

---

## S7: Envio on Monad

- HyperIndex supports Monad mainnet `143` (`https://143.hypersync.xyz`) and testnet `10143` (`https://10143.hypersync.xyz`), both with HyperSync (not RPC-only).
- Perpl events come from the same ABI (for example `PositionOpenedV2`, `TakerOrderFilledV2`, `PositionClosed`, `OrderCancelled`), so the indexer can track the exchange contract filtered to our accounts' IDs alongside our own contracts.

---

## Monad measurements

- **Block time**, measured over 2,000 blocks: mainnet 302 ms/block, testnet 312 ms/block. Services measure this at startup (PRD rule 6); 150 blocks is about 45 s.
- **Differences confirmed** (`docs.monad.xyz/developer-essentials/differences`):
  - Gas is charged on the gas limit.
  - A 7702-delegated EOA keeps a 10 MON reserve.
  - Full nodes serve no arbitrary historical state.
  - The contract size limit is 128 KB.
- Timestamp sharing between blocks isn't mentioned on that page; we use `block.number` for all windows regardless.
