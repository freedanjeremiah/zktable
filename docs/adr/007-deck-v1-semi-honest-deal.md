# ADR 007 — `deck` v1: semi-honest committed deal, not full mental-poker

## Status
Accepted (PRD §7.2, decided before build; implemented at M6.3).

## Context
"Mental poker" — dealing cards fairly with no trusted dealer and no way for
any colluding subset of players (or the shuffler) to know or bias the deal —
is a hard cryptographic problem in general, typically solved with
commit-and-shuffle protocols or coSNARKs across multiple parties. Building
that at full rigor was explicitly called out as out of scope for v1 (PRD
§3.2, §7.2) because it would have consumed a disproportionate share of the
build for one of three example games.

## Decision
Ship a documented, honest simplification: a designated dealer/orchestrator
supplies each player's per-card commitments during a `Deal` phase, and the
`card_membership` circuit proves — genuinely, in zero knowledge — that a
claimed character sits in a player's *already-committed* hand, without
revealing which slot or the other card. What is **not** proven is that the
deal itself came from a valid, unbiased shuffle over the shared deck; a
`valid_shuffle` circuit (proving a permutation is a bijection over `[0,N)`,
specified in PRD §7.2) was deliberately not implemented.

## Consequences
- **Positive:** the part of "prove-hold-or-bluff" that matters for the
  showcase — a player cannot fabricate a satisfying witness for a card they
  don't hold, so a bluffer must concede via `reveal_card` — is real,
  circuit-enforced, and proven on live testnet (two real
  `card_membership` proofs verified cross-contract in the M6.3 on-chain run,
  including a proof-binding rejection test against a different player's real
  commitments). This was reachable within the build's timeline precisely
  because the harder shuffle-fairness problem was scoped out.
- **Negative:** as shipped, Coup-lite's `deal()` step trusts the dealer not
  to collude with a specific player or bias who receives which cards. This
  is stated plainly in three places in the code (the circuit's module doc,
  `coup-referee`'s module doc, `coup-lite.ts`'s module doc) and in the
  top-level README's Limitations section — not something to discover by
  reading the contract source.
- The `zk.deck.shuffle()` TS marker exists in `@zktable/core` (added at
  M6.3) as an inert placeholder for exactly this future work — a
  `valid_shuffle` circuit could be wired behind that same call shape without
  changing any game-definition code, consistent with ADR 001's
  compose-don't-compile promise that new circuit capability slots in behind
  a stable primitive API.
