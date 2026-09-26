# Design system — Fey-led

Primary reference: **Fey** (owner's choice, Sep 26). Matte near-black canvas, one narrowed sans doing every job, the
product itself as the imagery, pill controls, and colour only as signal. This replaced the light "paper and ink" theme
of Sep 24.

The product idea survives inside it: **the agent proposes, the chain decides.** On every screen, whatever the chain
decided sits on the lighter `--midnight` surface with a verdict badge.

## Rules that cannot be broken

1. **Product words, never contract names.** "Blocked on-chain", not `execute()` reverted. "Report fingerprint", not
   `reportHash` or `keccak256`. "Stored on Monad", not `MandateRegistry`. Contract detail lives one click away.
2. **One family.** Instrument Sans for everything, narrowed with `font-stretch: 85–90%` at display sizes. Monospace
   (Fira Code) only for literal addresses, fingerprints and block numbers.
3. **Big, narrow, calm headlines.** `.display` is 46–96px, weight 600, `-0.055em`. `.section-heading` is 32–52px,
   weight 560. Never heavier.
4. **Colour is signal.** `--held` green = the chain allowed it. `--breach` ember = the chain stopped it or paid out.
   `--pending` amber = waiting on a window. `--action` blue = navigation, links, focus. Nothing decorative.
5. **Product as imagery.** Hero and feature images are the real screens drawn in code, using real testnet data,
   floating with `--shadow-float` and lit from behind by `--ember-glow` / `--frost-glow`. Glows sit behind products
   only, never on a surface.
6. **Shapes.** Pills (`99px`) for every control and badge, `16px` cards, `20px` product windows, `10px` inputs.
7. **Fewer boxes.** A card is only for something you interact with. Groups of text use space and a hairline instead.
8. **Honest imagery.** Every number in a product image is read from a live account. Label anything replayed.

## Tokens

All in `app/src/app/globals.css`. Names are semantic and kept from the old theme, so every module re-skins:

| Token | Value | Meaning |
|---|---|---|
| `--paper` | `#0b0b0b` | canvas |
| `--surface` | `#131313` | panel, input well |
| `--midnight` | `#1a1a1a` | the chain's surface |
| `--ink` | `#f4f4f2` | primary text; also the primary button fill |
| `--graphite` / `--fog` | `#868f97` / `#a9b0b6` | secondary / body-on-dark text |
| `--hairline` / `--hairline-strong` | 8% / 16% white | dividers, borders |
| `--held` / `--breach` / `--pending` / `--action` | `#4ebe96` / `#ff8f5e` / `#f2b84b` / `#479ffa` | signals |

Selected options are the luminous inverse: `--ink` fill, `--paper` text.

## Classes

`.display` · `.section-heading` · `.body-secondary` · `.editorial` · `.onchain` · `.card` · `.card-ink` · `.badge`
(with `data-tone="held|breach|pending"`) · `.button-primary` (luminous pill with a soft glow) · `.button-ghost` ·
`.rule` · `.visually-hidden`.

## Layout

Max width 1200px. Section gap 120px on the landing page. 16px gutters on phones, 44px minimum tap targets. Horizontal
overflow is clipped page-wide so glows can bleed past edges without sideways scrolling.

## Live accounts the UI points at

`0xAdb15A72D8e01FC641ad2E218E060e434f2610e0` is the agent with a live Nansen mandate on the current contracts (12.0x
blocked, $143.47 filled, breach paid). `0x3d0e…5F3A` predates the Sep 23 redeploy and has no mandate on the current
registry; don't link to it.
