# Mandate

> Nansen evidence doesn't inform a human decision here — it is compiled into limits a smart contract enforces, and the report that justified them is hashed on-chain with the mandate.

Fund an AI trading agent on Monad. Rules it could break are reverted inside its own trade. Rules the market breaks are caught on-chain and paid from the operator's bond.

**Live app:** _[paste Vercel URL before submit]_  
**Demo video (3 min):** _[paste link before submit]_  
**Network:** Monad testnet · **Data:** [Nansen](https://www.nansen.ai) · **Checklist:** [docs/submission-nansen.md](docs/submission-nansen.md)

> Contracts are unaudited. Use small funds only.

## The Nansen argument

Almost every entrant will print Nansen numbers on a dashboard. Mandate does something else:

1. **Live underwriting** pulls smart-money perp positioning, net flows and holder concentration.
2. A published regime table turns that evidence into **concrete limits** (leverage, notional, cooldown, drawdown).
3. The full report is stored; its **keccak256** is written into `MandateRegistry` with the mandate.
4. Every trade goes through `MandateAccount.execute` — a broken action rule **reverts in the same transaction**.

Judges can underwrite live at `/mandates/new`, verify the hash in-browser, then watch enforcement on a funded testnet account.

![Agent proposes high leverage on parchment; chain reverts at the Nansen-sized limit on ink](docs/demo-split.svg)

## Try it

1. **Underwrite with Nansen** (`/mandates/new`) — live API only; each limit names the signal that produced it; verify `reportHash`.
2. **Agents** (`/agents`) — live MandateAccounts with equity, bond and breach counts.
3. **Enforcement** (`/agents/0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A`) — paper / ink split; 11.3× blocked against 1.5×.
4. **Breach + bond** (`/agents/0xAdb15A72D8e01FC641ad2E218E060e434f2610e0`) — flagged in 6 blocks; backer paid **$0.109218**.

## Proven on Monad testnet

| Proof | Detail |
|---|---|
| Live underwriting | Nansen → regime → limits; report keccak256 verifiable in-browser |
| On-chain hash | Same `reportHash` in `MandateRegistry` as in the UI |
| Blocked trade | `MandateViolation` — observed **11.3×** vs **1.5×** limit; nothing changed on-chain |
| Breach + bond | Flagged in **6 blocks**; bond paid **$0.109218** (exact loss from peak). Flag `0x76f0f447…`, slash `0xacfd9371…` |
| Invariants | Eight PRD invariants over **16k** fuzzed calls |

## Testnet addresses

| Contract / account | Address |
|---|---|
| MandateRegistry | `0x9e6F25f2291AFD83d56fFf502670Dcc781E2A133` |
| MandateAccountFactory | `0x8F721E6B1367d471cFbA5fBdBbD714f208eB4F34` |
| PerplAdapter | `0xE8F999dECEB04FC84a9da540b577cB4C66ec69bE` |
| Nansen-backed MandateAccount | `0x3d0ec7098437A9755F2C0Bc6C43D250464225F3A` |
| Report hash | `0xa4b2c54774d859c37c6013743a3dff3c72af8bb949932c369e21ef0bc317a873` |
| Breach account | `0xAdb15A72D8e01FC641ad2E218E060e434f2610e0` |

Full handoff: [docs/handoff.md](docs/handoff.md).

## How it works

1. **Underwrite.** Nansen smart-money evidence sets a risk regime per market. A published table maps regime → limits. The report is stored off-chain; its keccak256 is `reportHash` on the mandate.
2. **Approve.** The backer signs in with a Mera passkey. A `MandateAccount` is created; the agent gets a session key that can only trade.
3. **Enforce.** Every agent trade goes through `MandateAccount.execute`. Action-rule breaks revert. Market rules (e.g. max drawdown) are flagged by a keeper; after the dispute window the bond pays the backer.

**What Nansen is not doing:** the agent model reasons and proposes trades. Nansen sets the limits. The chain enforces them.

## Deploy for judges

```bash
# Vercel (or similar): NETWORK=testnet, MONAD_TESTNET_RPC_URL, NANSEN_API_KEY required
# Do not set ALLOW_NANSEN_FIXTURE on the public deploy
```

## Repository

```
contracts/        Foundry: MandateRegistry, MandateAccount(+Factory), rules, PerplAdapter
services/
  common/         ABIs, network config, Perpl encoding, rule copy
  underwriter/    Nansen → regime → limits → report hash
  agent/          runtime (Claude / Kimi)
  keeper-cre/     Chainlink CRE keeper
  keeper-relayer/ fallback relayer
indexer/          Envio HyperIndex
app/              Next.js PWA
docs/             PRD, plan, design, decisions, handoff, Nansen checklist
```

## Run locally

Requirements: Foundry, Node 22+, pnpm 10, a Nansen API key.

```bash
git clone --recurse-submodules <repo> && cd mandate
cp .env.example .env   # set NANSEN_API_KEY, NETWORK=testnet, RPC, agent keys
pnpm install
NETWORK=testnet pnpm --filter app dev
```

Open `http://localhost:3000`. Local engineering without a key can set `ALLOW_NANSEN_FIXTURE=1` — that path is disabled on the judge-facing deploy.

## Tests

```bash
cd contracts && forge test
cd contracts && FOUNDRY_PROFILE=fork forge test -vv   # needs MONAD_RPC_URL
pnpm --filter @mandate/common test && pnpm --filter underwriter test
```

## Notes

- **Unaudited.**
- Track-record history needs the Envio indexer; without it those strips hide themselves.
- Local fork shims (`fork:sync`, `/api/dev/fund`) refuse to run on a real network.
