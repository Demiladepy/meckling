# Design system — paper and ink

One system, resolved from two references: **Era** (warm editorial paper, pill actions, near-monochrome) and
**Altitude** (serif display on near-black, hairline structure, tabular data). They are not blended at random. The
split is the product:

> **The human side of every screen sits on parchment. Anything the chain decided sits on ink.**

That is the split screen (agent left, chain right), the verdict cards, the breach rows and the Risk tiles. Colour is
never decoration; it marks whose voice is speaking.

## Rules that cannot be broken

1. **Headlines are the serif at weight 400.** Libre Baskerville, `-0.025em`. Never 600, never bold, never a
   sans-serif headline. The light serif at large size is the entire voice.
2. **Body and UI are Inter.** 16px/1.5, `-0.16px`. 15px for secondary copy, 13px for captions.
3. **Numbers are tabular.** `font-variant-numeric: lining-nums tabular-nums` is set on `body` and must never be
   turned off — every column of dollars and basis points depends on it.
4. **Zero shadows.** Elevation is surface colour plus a 1px hairline. Nothing in this product casts a shadow.
5. **Three radii.** Buttons `9999px`, cards `12px`, badges `6px`. Inputs `8px`, media `16px`. Nothing else.
6. **The page is parchment `#f3f3f1`, never white.** White is a card on top of it.
7. **The primary action is ink, not blue.** `#191a17` fill, white text, pill. Blue (`#2b7fff`) is for focus rings
   and inline links only.
8. **Monospace is only for literal chain identifiers** — addresses, hashes, block numbers. Never for prose.

## Tokens

All in `app/src/app/globals.css`. Use the variables; never hardcode a hex in a component.

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f3f3f1` | page canvas |
| `--surface` | `#ffffff` | card on paper |
| `--ink` | `#191a17` | text, primary button fill |
| `--graphite` | `#6b6a66` | secondary text |
| `--hairline` | `#e6e6e4` | borders, dividers |
| `--midnight` | `#181818` | the chain's surface |
| `--midnight-card` / `--midnight-raised` | `#1f1f1f` / `#262626` | panels and rows inside ink |
| `--bone` / `--fog` | `#eeeeee` / `#a4a19b` | text on ink, muted text on ink |
| `--action` | `#2b7fff` | focus ring, inline link |
| `--breach` / `--pending` / `--held` | `#c8452f` / `#b07d16` / `#2f7d52` | blocked · waiting · allowed |
| `--sage` | `#add2d1` | one calm panel, used sparingly |

The three state colours are a deliberate departure from both references, which are strictly monochrome. A risk
product has to name blocked, pending and held; desaturating them keeps them inside the palette.

## Classes

`.display` · `.section-heading` (serif) · `.body-secondary` · `.editorial` · `.onchain` · `.card` · `.card-ink` ·
`.badge` · `.button-primary` · `.button-ghost` · `.rule` · `.visually-hidden`.

Inside `.card-ink`, badges and ghost buttons invert automatically.

## Layout

Page max-width 1200px (1120 on the split screen, 520 on the phone surface). Section gap 80px, card padding 24px,
element gap 16px. Mobile: 16px side gutters, 44px minimum tap target, `env(safe-area-inset-*)` respected.

## What still needs doing

- A pass over leftover hardcoded colours onto tokens (a few midnight contrast lifts remain intentional).
- Paste live URL + video into the README before Nansen submit.
