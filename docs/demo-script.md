# Demo script: Nansen Meridian (3 minutes)

One argument, said early and proven on screen:

> Nansen's data doesn't inform a person here. It becomes limits a smart contract enforces, and the report behind them
> is fingerprinted on-chain so anyone can check.

Record at 1440×900, browser zoom 110%, one tab, notifications off. Speak slower than feels natural.

## Before you press record

- [ ] **Nansen credits:** run one underwriting off-camera and confirm the badge says "Nansen connected" and the
      report says "Live Nansen data", not "Sample data". If it says sample data, stop, the demo depends on this.
- [ ] **Passkey account has MON for gas.** Sign in once off-camera, copy the address from the header, and send it
      ~0.5 testnet MON. Approving a mandate costs two transactions.
- [ ] **Dry run the whole flow once.** Passkey prompts and block confirmations take a few seconds; know where they are.
- [ ] Open these in order, logged in:
      1. `/` (landing)
      2. `/mandates/new`
      3. `/agents/0xAdb15A72D8e01FC641ad2E218E060e434f2610e0` (the live agent)

## The script

### 0:00–0:15 · Landing: say the argument

Show the hero. Point at the agent's quote in the product window.

> "This is Mandate. AI traders on Monad that can't break your rules. The agent here is quoting a Nansen report , 
> smart money net short BTC, and trying to go 12x. The chain said no."

### 0:15–1:05 · Back an agent: Nansen becomes limits

Click **Back an agent**. Point at the green **Nansen connected** badge.

1. Select BTC and ETH. Click **Get limits from Nansen**.
2. While it loads: *"This is a live call to Nansen, smart-money flows and perp positioning for each market."*
3. When the evidence cards appear, read **one** signal out loud, then find the limit it produced in the table.
   > "Nansen says smart money is doing *this*, so BTC gets a *$X* limit. Every limit names the signal behind it."
4. Point at **Nansen's read** (the regime). *"Risk-off means tighter limits. Risk-on would loosen them."*

### 1:05–1:40 · Approve: the fingerprint goes on-chain

1. Click **Approve mandate on-chain** and confirm with the passkey. *"No seed phrase, no extension, a passkey is the account."*
2. When it lands, point at **Report fingerprint on Monad**.
3. Click **Check the fingerprint**. Wait for the match.
   > "My browser just recomputed the report's fingerprint and compared it to what's stored on Monad. They match.
   > Anyone can do this. The limits provably came from that Nansen report."

### 1:40–2:25 · The agent screen: the chain decides

Open the live agent. Scroll slowly.

1. First row, left: *"The agent reads the Nansen report and wants 12x."*
2. First row, right: **Blocked on-chain**. *"The limit is 1.5x. The trade reverted inside its own transaction , 
   nothing reached the exchange."*
3. Second row: **Filled on Perpl**. *"It scaled down to 0.7x, inside every rule, and filled."*
4. Point at the **Headroom** bars. *"Live headroom against every limit."*

### 2:25–2:50 · The breach: the bond pays

Scroll to **Breach flagged on-chain** and click **Open breach detail**.

> "Some limits the market breaks, not the agent. When this account fell past its drawdown floor, a keeper flagged it
> within 6 blocks, the position was closed in the same transaction, and after the dispute window the operator's
> bond paid the backer the exact loss: 10.9 cents, to the millionth of a dollar."

### 2:50–3:00 · Close

Back to the landing hero.

> "Nansen sets the limits. Monad enforces them. The bond pays when the market breaks one. That's Mandate."

## If something goes wrong on camera

- **Nansen call fails or shows sample data:** stop and re-record. Don't narrate over sample data.
- **Passkey prompt doesn't appear:** the browser needs a platform authenticator; use Chrome with Windows Hello or
  iCloud Keychain.
- **Approval stuck:** the passkey account is out of MON. Fund it and retry.
- **Agent page empty:** the dev server's cache went stale. Stop it, delete `app/.next`, start it again.

## What the video must not claim

- The 12x attempt was a deliberate test of the limits. Say "tries 12x", don't imply the model went rogue.
- The keeper that flagged the breach is the fallback relayer, not CRE. Don't say Chainlink ran it.
- Everything is on Monad **testnet** with test AUSD.
