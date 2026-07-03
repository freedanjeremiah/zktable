# ADR 009 — `deck` v1.5: seed-forced shuffle, position-assigned hands

## Status
Accepted (M8.3). Supersedes the "deal is trusted" half of ADR 007; the
"dealer sees the cards" half of ADR 007 still stands.

## Context
Deck v1 (ADR 007) let a semi-honest dealer supply hand commitments directly:
nothing stopped a colluding dealer from stacking the deal. The PRD's
`valid_shuffle` sketch (§7.2) proved only that a permutation is a bijection —
which removes duplicate-card cheating but still lets the dealer *choose*
which bijection, i.e. still choose who gets what.

## Decision
Make the permutation itself unchoosable. The deal becomes three steps, all
on-chain:

1. **Seed:** every player runs a sealed nonce commit-reveal (the liars-dice
   referee's exact pattern); the referee folds the nonces into a seed.
2. **Shuffle proof:** the dealer submits the 15 committed deck leaves
   (3 copies × 5 characters — real Coup, sized so position-dealt hands cover
   the referee's full 2–4 player range) plus a `valid_shuffle` proof. The
   circuit proves (a) bijection over the canonical deck, (b) every leaf is
   `Poseidon2(card, salt)`, and (c) **the order is the unique one sorted by
   `Poseidon2(seed, index)` keys** (low-64-bit truncation, protocol-defined
   and byte-matched by `zktable-graph shuffle-witness`). The referee rebuilds
   public inputs from its OWN stored seed (ADR 004), so a proof for any other
   seed or order is rejected.
3. **Positional deal:** player p's hand is deck positions 2p and 2p+1, fixed
   in contract code. The `deal` entry point is gone.

The dealer's only remaining input is the salts — which affect commitment
bytes, never card placement.

## Consequences
- A colluding dealer can no longer bias or stack the deal; fairness reduces
  to the commit-reveal seed, whose bias-resistance is the same
  all-commit-before-any-reveal argument the dice module already relies on.
- The dealer still generates salts and therefore still *sees* all cards
  (limitations §1). Removing that requires mental-poker/MPC — deck v2.
- `card_membership` needed no changes: deck leaves use the same
  `Poseidon2(card, salt)` shape hand commitments always had.
- Cost: one extra verifier instance (the `valid_shuffle` VK), two
  commit-reveal rounds, and one 14592-byte proof per match — all verified in
  the M8.3 testnet run.
