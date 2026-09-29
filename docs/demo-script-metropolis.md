# Metropolis videos — scripts

Three videos. The rules (§4.1, §9.4) require the demo to show **the live product actually operating, with Monad
interactions** — no slides, no mockups — and cap it at 3 minutes. The pitch is 2 minutes. The ad is optional and not
judged.

Record the product at 1440×900, browser zoom 110%, dark mode, one tab, notifications off. Keep the cursor slow.

---

## 1. Technical demo — 3:00 (required)

Built so a judge from **any** sponsor sees their integration inside the first minute they care about. Every on-chain
moment shows a transaction hash or a block number on screen.

| Time | Screen | What happens | Say |
|---|---|---|---|
| 0:00–0:12 | Landing hero | The product window with the blocked 12× trade | "AI agents can trade your money. Mandate makes sure they can't break the rules you set — enforced on Monad, not promised." |
| 0:12–0:45 | **Back an agent** | Pick BTC and ETH → **Get limits from Nansen** → evidence cards → limits table | "Nansen's smart-money flows and perp positioning set every limit, and each limit names its signal." Point at one row. |
| 0:45–1:05 | Approve | Passkey prompt → mandate written → **Check the fingerprint** → match | "The report's fingerprint is stored on Monad. My browser just recomputed it — it matches. Anyone can check." |
| 1:05–1:35 | Live agent screen | Row 1: agent tries 12× → **Blocked on-chain**. Row 2: 0.7× **Filled on Perpl**. Headroom bars | "The agent trades on Perpl through its account. A 12× order reverted inside its own transaction; the 0.7× one filled." |
| 1:35–2:05 | Terminal: `cre workflow simulate … --broadcast` | The log line *"Perpl API agrees on 1 market(s)"*, then the explorer showing the `BreachFlagged` tx | "Market rules are watched by a Chainlink CRE workflow. It flags a breach only when Monad, the Chainlink feed and Perpl's own API all agree — here it just did, on-chain." |
| 2:05–2:25 | Breach detail | Flagged → position closed → **Bond paid $0.109218** | "The position closes in the same transaction, and the operator's bond pays the backer the exact loss." |
| 2:25–2:45 | Risk screen | Worst drawdown and trades blocked (both read from the indexer) | "History comes from an Envio indexer — Monad nodes don't serve it." |
| 2:45–3:00 | Phone, `/trade` | Passkey sign-in, AUSD balance, one filled trade, one blocked trade | "And the same protection on your phone, for your own trading. That's Mandate." |

**Before recording:** Nansen credits confirmed, the passkey account holds ~0.5 test MON, a fresh breach staged for the CRE
segment (`pnpm --filter agent stage:breach`), and the phone clip recorded separately and cut in.

**Do not claim:** that the model went rogue (the 12× was a deliberate test), that CRE is deployed live (it is simulated
and broadcast — say "simulated"), or that anything is on mainnet if it isn't.

---

## 2. Pitch — 2:00 (required)

You on camera, then the product. The rules ask for the team, the problem and why you are building it. The track's
judges weigh **who the first user is** and **why this market doesn't exist yet** — answer both out loud.

| Time | Beat | Words (say it in your own voice) |
|---|---|---|
| 0:00–0:15 | Who | "I'm Demilade, a builder from Nigeria. I build on Monad." |
| 0:15–0:45 | The problem | "People want AI agents to trade for them. Nobody sane hands an agent their capital, because its limits are promises. An exchange's limits protect the exchange; a dashboard tells you after the damage." |
| 0:45–1:15 | The insight | "Economists call the fix agency costs: monitor the agent, make it post a bond. Mandate does both in code. The rules run inside every trade on Monad, and when the market breaks one, the operator's bond pays you." |
| 1:15–1:40 | Why now, why Monad | "This needs a chain fast and cheap enough to check every rule inside every trade. On Monad it adds about 214,000 gas and settles in under a second." |
| 1:40–2:00 | First user and next step | Name the first user from your interviews and a number: "*[Name]*, who trades perps, will back the first agent with *$X*. Next: *[target]* by *[date]*." |

Record the last 20 seconds **after** this week's interviews. A real name and a real number beat anything else here.

---

## 3. Product ad — 0:30 (optional, not judged)

For X and post-event promotion. Product footage only, fast cuts, no voice, one line of text per shot.

| Time | Shot | On-screen text |
|---|---|---|
| 0:00–0:04 | Black. The Mandate mark fades in | *Your agent trades.* |
| 0:04–0:09 | Agent reasoning types out: "Going 12x long." | *It wants more risk.* |
| 0:09–0:14 | Ember verdict slams in: **Blocked on-chain · 12.0× over 1.5×** | *The chain says no.* |
| 0:14–0:19 | Green verdict: **Filled on Perpl** | *It trades inside your rules.* |
| 0:19–0:25 | Breach timeline, ending on **Bond paid $0.109218** | *And when the market breaks one, you're paid back.* |
| 0:25–0:30 | Logo, URL | *Mandate. Rules your agent can't break.* |

### How to make it

Claude can't generate video from a prompt, and neither can Hermes by itself. Your options:

- **Remotion** (recommended). A video written as React code, rendered to MP4. It can reuse the product's own components
  and real testnet numbers, so every frame is the real UI, sharp at any size. Claude can build this.
- **Screen Studio** (Mac) or **Cursorful** / **Tella** (Windows-friendly): record the real app; they add the smooth
  zooms and cursor motion that make product ads look expensive.
- **Veo, Sora, Runway**: text-to-video. Fine for a few seconds of atmosphere, but **never** for the judged demo — the
  rules require the real product operating.
