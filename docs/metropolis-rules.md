# Metropolis rules — what binds us

A summary of the clauses in the official Terms & Conditions (v3.0, last updated Sep 3, 2026) that affect Mandate. The
full text lives on the hackathon website; read it there before submitting. Summarised Sep 29.

## Deadlines and prizes

- **Submission deadline: Oct 13, 2026, 11:59 PM ET.** No late submissions. The version on the platform at the deadline
  is the version judged; it can be edited until then.
- Judging Oct 14–27. Winners announced **Nov 3**.
- Prizes: one **overall winner, $25,000**; in each of four tracks, **$10,000 each to the top three**. Sponsor bounties are
  on top, with their own requirements. Paid in USDC; KYC may be required; taxes are the winner's.

## Eligibility and entry

- One project per participant. **One track only** (ours: Track 01, Onchain Finance & Trading). A project can't win
  several main-track prizes.
- Teams of 1–5. The designated contact receives the prize.
- Sanctions screening applies to registrants and wallet addresses.

## Mandatory for every submission (§4.1, §7.2, §9) — status

| Requirement | Status |
|---|---|
| Public GitHub repo with complete source, README with setup instructions | Done |
| **OSI open-source license** | Done: MIT (`LICENSE`), added Sep 29 |
| Clear attribution of external code and libraries | Done: README, "How this was built" |
| Commit history covering the build window | Done: first commit Sep 21 |
| Pre-existing code identified in the README | Done: none reused, stated in README |
| **Use of AI coding tools disclosed in the README** | Done: README, "How this was built" |
| Demo video ≤ 3 minutes, public, showing the product in actual operation and Monad interactions | To record for Metropolis |
| How the project uses Monad, contract addresses or tx hashes, deployed to mainnet or testnet | Done: README; "why Monad" section still to strengthen |
| Documentation: description, architecture, stack, setup | Done: README + `docs/` |
| A third party can run the code by following the README | Check before submitting |
| Nothing confidential, no keys or credentials in the submission | Secret scan in `CLAUDE.md` returns 0 |

## How it is scored

**The rules and the track page disagree.** The Terms (§5.2) score every track equally on five criteria:

| Product quality & completeness | Technical excellence | Monad integration | Track fit & problem relevance | Innovation & impact |
|---|---|---|---|---|
| 20% | 20% | 20% | 20% | 20% |

The Track 01 page lists a different set: technical execution 20%, design & craft 20%, originality 15%, founder & market
readiness 25%, traction & path forward 20%. **Ask the organisers in Discord which applies**, and prepare for both. Under
either, **Monad integration** or **market readiness and traction** are the areas we are weakest in.

Sponsor bounties are scored (§5.2): **adherence to the bounty's published requirements 40%**, technical implementation
30%, Monad integration 20%, innovation 10%. Meeting each bounty's stated deliverables to the letter is worth the most.

## Things that could disqualify us

- A missing mandatory component (above).
- False or misleading information — every figure in the README must stay checkable on-chain.
- Code that harms or deceives users. Local-fork shims refuse to run on real networks, and they must keep doing so.
- Submissions are **non-confidential**: judges and sponsors may build similar products. Nothing secret goes in.
