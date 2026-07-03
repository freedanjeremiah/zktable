# Design: `valid_shuffle` circuit — provably fair committed deal

**Status:** approved for implementation (M8.3)
**Handoff item:** #3 — "`valid_shuffle` circuit to remove the deck's
semi-honest-deal assumption."

## Problem

Nothing proves the Coup-lite deal came from a fair shuffle. The dealer picks
hands directly (`games/coup-lite/src/runner.ts:191-208`) and the referee's
`deal()` stores whatever commitments it is given (`coup-referee/src/lib.rs:339`).
PRD §7.2 specifies `valid_shuffle` (public permutation root, private
permutation, prove bijection) but leaves the deal *binding* and the
permutation's *fairness* open. `zk.deck.shuffle()` is already reserved as the
inert marker (`packages/core/src/zk.ts:69`), and ADR 007 promises it can be
wired in without touching game definitions.

## Goal

The dealer can no longer choose who gets which card. One proof, verified
on-chain before any hand exists, shows the entire committed deck is the
canonical card set permuted by a **seed-derived** order, where the seed comes
from both players' commit-reveal randomness. Hands are then assigned by fixed
deck position — `deal` stops accepting commitments from the caller entirely.

## Non-goals

- Card **privacy from the dealer**: the dealer still generates salts and sees
  all cards. Removing that requires mental poker / MPC (PRD's stated v2
  ceiling). `docs/limitations.md` §1 is rewritten, not deleted.
- Changing `card_membership` — it keeps working unchanged because deck-leaf
  commitments use the identical `Poseidon2(card, salt)` form the hand
  commitments already use.
- Merkle roots. The deck commitment is simply the leaf commitments as public
  inputs (no tree needed at this size). A Merkle-rooted variant is a
  documented follow-up for big decks.

> **Implementation amendments:**
> - Sort-key truncation is **64-bit** (`k as u64` in-circuit, `k mod 2^64`
>   in `zktable-graph`), not the 128-bit sketch below — protocol-defined,
>   see ADR 009 (tie probability ~2^-57 across 15 keys).
> - The stored seed is the **left-fold** `hash2(hash2(0, n_0), n_1)` — the
>   liars-dice referee's exact formula this spec says it mirrors (the
>   `Poseidon2(nonce_0, nonce_1)` line below was internally inconsistent).
> - `shuffle-witness` requires `--salts` (the runner generates them);
>   tool-side salt generation was dropped as redundant.
> - The deck is **15 cards (3 copies × 5 characters, real Coup)**, not the 5 sketched below — a 5-card deck caps
> position-assigned hands at 2 players, which would have regressed the
> referee's (and M8.2's) 2–4 player support. Positions 2p/2p+1 deal up to 4
> players; the rest stay burned. Constraint counts stay trivial (105
> pairwise inequalities, 30 Poseidon hashes, 14 comparisons).

## Design

### Protocol (new Coup-lite phases, mirroring Liar's Dice's seed pattern)

1. **SeedCommit:** each player submits `Poseidon2(nonce_i, 0)` (same
   commit-reveal shape as `liars-dice-referee`'s `commit_nonce`).
2. **SeedReveal:** nonces revealed and checked; referee stores
   `seed = Poseidon2(nonce_0, nonce_1)`.
3. **Shuffle:** the dealer submits `(leaves[5], proof)`. The referee
   reconstructs public inputs from its **own stored seed** (ADR 004
   invariant) as `seed ‖ leaves[0..5]`, verifies the `valid_shuffle` proof
   via a second verifier-contract instance, and stores the leaves.
4. **Deal (trustless):** referee assigns hand commitments itself:
   player *p* gets deck positions `2p` and `2p+1` (2 players × 2 cards uses
   4 of 5 leaves; the 5th is the burn card). The existing `deal(player,
   commitments)` entry point is **removed**; `PlayerData.commitments` is
   populated internally at the end of the Shuffle step, then
   `Phase::Playing`. Dealer hands each player their `(card, salt)` pairs
   off-chain, exactly as today.
5. Play proceeds unchanged (`claim`/`challenge`/`prove_hold`/`reveal_card`
   all operate on the same per-card commitment format).

### The circuit (`packages/circuits/valid_shuffle`)

- **Public inputs (6 fields):** `seed`, `leaves[5]`.
- **Private witness:** `perm[5]`, `salts[5]`.
- **Constraints:**
  1. *Bijection:* each `perm[i]` ∈ `[0,5)` (assert via product
     `∏(perm[i]−j)=0` over j) and pairwise-distinct (O(N²)=10 inequality
     checks — trivial at N=5).
  2. *Commitment correctness:* `leaves[i] == Poseidon2(perm[i], salts[i])`
     for all i — the canonical deck is the identity list `[0..5)`, so the
     card at deck position i is just the field value `perm[i]`.
  3. *Seed-derived order (the fairness core):* let
     `k[i] = Poseidon2(seed, i)`. Assert the permutation sorts the keys:
     `lt(k[perm... ]` — concretely, assert `k[perm[i]] < k[perm[i+1]]` for
     i in 0..4 using Noir's field comparison on the low 128 bits
     (`k as u126` truncation, uniform enough for ordering). With keys
     distinct w.h.p., exactly **one** permutation satisfies this — the
     dealer has zero degrees of freedom over card order.
- Hash: `Poseidon2::hash([a,b], 2)` from the same `poseidon v0.2.0` dep as
  `card_membership` — byte-compatible with `soroban-poseidon` on-chain and
  `zktable-graph` off-chain (architecture invariant #3).
- In-circuit tests: honest shuffle passes; non-bijection fails; correct
  bijection in *wrong order* (not seed-sorted) fails; wrong salt fails.

### Off-chain tooling

- `zktable-graph` gains a `shuffle-witness` subcommand: input seed; computes
  keys, sorts to derive the unique valid `perm`, generates salts
  (or accepts them for determinism in tests), emits `Prover.toml` + JSON
  (leaves, public-inputs blob `seed ‖ leaves`) — same pattern as the
  existing `card-witness` arm.
- `CardProver` gains `proveShuffle(seed): ShuffleResult` following
  `proveHold`'s compile→execute→prove flow, plus `shuffleLocalVerify`.
- Coup runner: seed phase calls, then `proveShuffle`, then `submit_shuffle`;
  hand `(card, salt)`s are read from the shuffle-witness output.

### Referee changes (`coup-referee`)

- New storage: `seedc0/seedc1` (nonce commitments), `seed`, `deck`
  (`Vec<BytesN<32>>`), second verifier address `shufvrf`.
- Constructor gains `shuffle_verifier: Address` (deployed with the
  `valid_shuffle` VK; the existing verifier contract is reused as-is — one
  instance per VK, matching the established one-VK-per-verifier pattern).
- New entry points `commit_seed_nonce`, `reveal_seed_nonce`,
  `submit_shuffle`; `deal` removed; `Phase` gains `SeedCommit`,
  `SeedReveal`, `Shuffle`.
- Public-inputs reconstruction for `submit_shuffle` uses the stored seed —
  a proof minted for a different seed is rejected (negative test).

## Testing

- `nargo test` in-circuit suite (above).
- Rust: referee happy path with real vendored fixtures
  (`valid_shuffle_vk`, a real proof + leaves for a known seed, generated the
  same way `coup-referee/tests/fixtures` were); negative tests: tampered
  proof, wrong-seed proof, non-matching leaves.
- TS: `proveShuffle` output leaves match `zktable-graph deal` commitments
  for the derived hands; local verify accepts/rejects.
- Testnet: full Coup-lite match through the new seed→shuffle→auto-deal flow
  with the shuffle proof verified on-chain (M8.3 evidence in milestones).
- Docs: limitations §1 rewritten — remaining trust is "dealer sees the
  cards", no longer "dealer chooses the deal"; ADR 007 gets a follow-up ADR.
