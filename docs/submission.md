# Metropolis submission kit

Everything for the form, in the order it asks. Copy, then edit into your own words where it says so.
Live app: **https://meckling.vercel.app** · Code: **https://github.com/Demiladepy/mandate** · Paper: **https://meckling.vercel.app/manifesto**

## The next 16 hours, in order

1. **Fill the text fields** (this file, 30 minutes).
2. **Record the phone demo** (Agora, up to 2 min). It is also your Perpl and Mera footage.
3. **Record the technical demo** (web, up to 3 min).
4. **Record the CRE and Nansen clips** (short screen recordings).
5. **Record the pitch** (in the car).
6. **Submit**, then check every video link opens in a private window.

Skip the custom domain unless you buy it in the next hour (see the end). `meckling.vercel.app` is fine.

---

## Form fields

**One-line description**

> Meckling enforces an AI trading agent's risk limits inside every trade on Monad, and a bond pays you back when the market breaks one.

Shorter, if there is a character limit: *AI traders that can't break your rules, enforced on Monad.*

**Logo:** `app/public/brand/mandate-logo-dark.png` (white cube on black) or `app/public/brand/mandate-logo.png` (black on white). Both 1024 x 1024 PNG. The files still have the old name; the mark is the same M cube.

**Track:** Onchain Finance & Trading.

**Live product:** https://meckling.vercel.app

**Judge access:** public, no credentials. Sign in with a passkey (Face ID or fingerprint), or a browser wallet. Tap **Get test MON and AUSD** for free testnet funds.

### Go-to-market and user acquisition

> Meckling starts where the pain is sharpest and the sale is simplest, then moves up to where the money is.
>
> **1. Self-traders on Monad (now).** Anyone can trade Perpl perpetuals under rules they set for themselves: max leverage, position size, a cooldown after a loss, price protection. It is free, takes a passkey and a minute, and answers a feeling every trader has had: "stop me before I revenge-trade." We acquire them where Monad traders already are: Perpl's community, the Monad Discord, and build-in-public posts showing real blocked trades on-chain. Every blocked trade is a public, shareable event.
>
> **2. AI agent builders (next 3 months).** An agent with a Meckling account can prove to backers that it cannot exceed its limits or withdraw their money, and can post a bond as skin in the game. That turns "trust my bot" into a checkable claim, which is what agent builders need to raise capital. We reach them through the frameworks they build on (Claude, OpenClaw, ElizaOS) with a drop-in account and a public list of bonded agents and their on-chain track records. Revenue: a small fee on capital backed under a mandate, and on underwriting reports.
>
> **3. Institutions (the path forward).** Brokers already must run automated pre-trade risk checks (SEC Rule 15c3-5) because of failures like Knight Capital's $460M in 45 minutes. As funds delegate to AI and quant managers on-chain, they need the same controls, verifiable by their allocators without revealing positions. Monad Private Settlement gives institutions private domains with public liquidity: their positions stay private, their Meckling mandate and breach record stay public. That is the long-term market.
>
> **Honest status:** live on Monad testnet with a Claude agent trading under 8 on-chain rules, two real breaches paid from a bond, and a public judge faucet. No external users yet; the first goal after the hackathon is ten self-traders and two agent builders using it on testnet, then a capped mainnet launch.

---

## Bounty answers

### Agora: best trading app on Monad

> Meckling's `/trade` screen is a phone-first trading app that uses all three together. **Mera** passkeys are the account: no seed phrase, no extension; the passkey derives the wallet and signs in the page. The app shows the **AUSD** balance of both the wallet and the trading account, and every bond and payout is in AUSD. Trades execute on **Perpl** through a Meckling account that checks the trader's own rules inside the same transaction, so a trade over your limit is refused on-chain before it reaches the exchange. The creative part: the trader writes their own rules once (leverage, size, markets, a cooldown after a loss, price protection) and the chain holds them to it, which no exchange setting can do.

Video: the phone demo below.

### Perpl: trading bot

> The bot is a Claude agent that trades Perpl perpetuals through a Meckling account. It reads a Nansen-based underwriting report, proposes an order, and every order passes eight on-chain rules before it reaches Perpl. Live agent: https://meckling.vercel.app/agents/0xB70a5C4A6af38Acc1a69bAf34224ED22e8B964C3 (two real fills: a $100 BTC short and an $80 ETH short, then holds when there is no new signal). Code: https://github.com/Demiladepy/mandate/tree/main/services/agent

### Nansen

Be exact here: we use the **API endpoints**, not the MCP tools or the CLI.

> Meckling turns Nansen data into limits a smart contract enforces. When a backer chooses markets, the underwriter calls four Nansen API endpoints: `/smart-money/netflow`, `/tgm/holders`, `/tgm/perp-positions` and `/smart-money/pnl-leaderboard`. It scores each market's regime (risk-on, neutral, risk-off) and sets leverage, position size, cooldown and a drawdown floor from it, with the reason for every limit shown. The full report is hashed (keccak256) and the hash is written on-chain with the mandate, so anyone can recompute it in the browser. The agent then reasons from the same report. We use the API endpoints only, not the MCP tools or the CLI.

### Chainlink CRE

> CRE is the orchestration layer for Meckling's keeper, the part that pays a backer when the market breaks a rule. Every 30 seconds the workflow reads each account's state on Monad, recomputes the drawdown rule, confirms the breach against Perpl's public API with the nodes agreeing by median, and only then writes a report through Chainlink's forwarder to our CreKeeperReceiver contract, which calls `flagBreach`. The contract re-checks the breach and Chainlink price feeds before acting, so a wrong report cannot pay anyone. On Monad testnet, the workflow flagged a real breach (tx 0xa97b6ebda5c1b131f56c16f797272d4cc5e1b43ec600f75ce1a55ff85ecb795d) and, on Oct 7, correctly took no action on a breach that had recovered.

### Mera: passkeys used for something other than a wallet

> Meckling uses the passkey's PRF output in a second, separate namespace: one salt per agent. That output becomes an encryption key, and the agent's reasoning is sealed to it. Only the backer's passkey can open the agent's private reasoning, on any device, and the operator never sees it. The wallet key and the memory key come from the same passkey under different salts, so neither reveals the other.

Video: the Mera clip below.

### Monad community supporters

**Remove this bounty** unless your community group is on the onboarded list. Nothing in the build can substitute for that.

---

## Video scripts

### Phone demo (Agora, up to 2 minutes, iPhone)

Record the phone screen (Control Centre, Screen Recording, with the mic on). Start with a fresh account.

1. **0:00** Open `meckling.vercel.app` in Safari. "This is Meckling, on Monad testnet."
2. **0:10** Tap **Trade**, then **Create your account**. Approve with Face ID. "No seed phrase. My passkey is the account, through Mera."
3. **0:25** Set rules: 3x leverage, $250 per market, BTC and ETH, a 15-minute cooldown. Tap **Create my account**. "These rules are written on Monad. They can only get stricter."
4. **0:50** Tap **Get test MON and AUSD**. Point at **Wallet: 150.00 AUSD**. "That's my AUSD balance."
5. **1:05** Tap **Open your account with $100 AUSD**. The trading account balance shows about 100 AUSD.
6. **1:20** Choose BTC, size 50, tap **Buy**. Show **Order placed**. "Filled on Perpl."
7. **1:35** Size 220, tap **Buy**. That would make the BTC position about $270, over the $250 limit. Show the block message. "Over my limit, so the chain refused it. Nothing changed on-chain."
8. **1:50** Tap **Close position**. "Closing is never blocked."

### Technical demo (web, up to 3 minutes)

1. **0:00** Landing page. Read the headline. Point at the chart: "Price can't cross your limit."
2. **0:15** Let the film play through scenes 2 and 3. "Every rule is checked inside the trade."
3. **0:35** **Agents**, then the Claude agent. Show its reasoning and the two fills. "A real Claude agent, trading on Perpl under rules set from Nansen data."
4. **1:05** Click **Check the fingerprint**. "The Nansen report's hash is on Monad. Anyone can verify where each limit came from."
5. **1:20** Open the **Breach, paid** agent, then **Open breach detail**. "The market broke the floor; the keeper flagged it, Chainlink prices confirmed it, and the bond paid 0.989276 AUSD, the exact loss."
6. **1:50** **Manifesto**, scroll to the gas table. "Measured on Monad: enforcement costs about 193k gas, and laying storage out for MIP-8 pages saved 21,342 per trade."
7. **2:20** GitHub: the green CI run (contracts, typescript, formal). "Eight symbolic proofs run on every push."
8. **2:45** Close: "Meckling. AI traders that can't break your rules."

### Chainlink CRE clip

In a terminal, with the screen recorder on:

```bash
cd services/keeper-cre
cre workflow simulate . -R . -T staging-settings --trigger-index 0
```

Press Enter when it says "Press Enter to skip waiting". It prints `Workflow Simulation Result: "checked 3 account(s) ... 0 action(s)"`: a successful simulation with no breach to flag. Then show `docs/cre-simulation.md` on GitHub for the run that flagged a real breach. If you want a fresh breach on camera, tell me and I'll stage one.

### Nansen clip

**Back an agent**, choose BTC and ETH, **Get limits from Nansen**. Show the evidence cards and the reason beside each limit. "Four Nansen endpoints become limits a contract enforces." Optionally approve with a passkey and show the fingerprint check on the new agent.

### Mera clip (needs me for one step)

1. Sign in with your passkey, **Get test MON and AUSD**, then **Back an agent**: get limits from Nansen, **Approve mandate on-chain**, then **Fund account** with 100.
2. Open that agent's page, tap **Make reasoning private** and approve with your passkey. "A second passkey namespace, not the wallet."
3. Send me the account address. I'll run the Claude agent on it for a few decisions.
4. Its new reasoning shows as private. Tap **Unlock with passkey**: it decrypts. "Only my passkey can read what the agent was thinking."

### Pitch (in the car, about 2 minutes)

In your own words; these are beats, not lines to read.

1. **Who you are** (10s). Your name, where you're building from, and that you build at the edge of AI and finance.
2. **The problem** (25s). Agents with money keep failing the same way: aixbt sent away 55 ETH, an agent sent a stranger a quarter of a million in tokens, frontier models lost up to 63% trading perps. Nothing outside the model said no.
3. **The insight** (20s). Spend caps limit how much an agent can move; the real risk is what it does over time. And the fix is fifty years old: Jensen and Meckling showed that when you hand someone your money, you pay to watch them or they post a bond. That's why it's called Meckling.
4. **How you got here** (30s). Be specific and honest: you read SEC Rule 15c3-5 and the Knight Capital case, studied what Monad's team is building (Keone's post on fair execution as a property of the infrastructure, the post-quantum roadmap, private settlement), read the mentors' feedback and rebuilt around it, and threw away claims you couldn't verify.
5. **Proof** (20s). Live on Monad testnet: a Claude agent trading under eight on-chain rules, two breaches paid from a bond, eight formal proofs, gas measured on Monad.
6. **Where it goes** (15s). From self-traders and agent builders to institutions that need pre-trade controls their allocators can verify, without revealing positions.
7. **Close** (5s). "Meckling. AI traders that can't break your rules."

---

## For a friend testing on an iPhone

Send them this:

> 1. You need iOS 18 or later, with iCloud Keychain on (Settings, your name, iCloud, Passwords and Keychain).
> 2. Open **https://meckling.vercel.app** in Safari.
> 3. Tap **Trade**, then **Create your account**, and approve with Face ID.
> 4. Leave the default rules or change them, then tap **Create my account**. Wait for both steps to finish.
> 5. Tap **Get test MON and AUSD**. You should see "Wallet: 150.00 AUSD".
> 6. Tap **Open your account with $100 AUSD**.
> 7. Pick BTC, type 50, tap **Buy**. You should see "Order placed".
> 8. Type 220, tap **Buy**. It should be refused with a message saying your limit is $250.
> 9. Tap **Close position**.
> 10. Optional: Share, **Add to Home Screen**, and open it from there.
>
> Tell me anything that confused you or failed, with a screenshot. All money here is free test money on Monad testnet.

---

## The custom domain (optional, only if bought in the next hour)

`meckling.xyz` is free: $2.04 for the first year at Porkbun, $14.21 to renew.

1. Buy it at porkbun.com (search `meckling.xyz`). You do the purchase.
2. Tell me. I'll add it to the Vercel project and send you the exact DNS records.
3. In Porkbun, under the domain's DNS records, delete the default parking records and add the records Vercel gives.
4. I'll confirm it serves the app with HTTPS and switch the links.

Record the videos after this, because passkey accounts are tied to the exact address.
