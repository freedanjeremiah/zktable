// zkTable `deck` module - `valid_shuffle` (M8.3): prove the entire committed
// deck is the canonical Coup card set permuted by a SEED-DERIVED order, so
// the dealer has zero freedom over which card lands at which deck position.
// Combined with position-assigned hands in the coup-referee (player p's hand
// is deck positions 2p and 2p+1, fixed at construction), this removes the
// deck v1 "semi-honest dealer chooses the deal" assumption (PRD SS7.2,
// docs/limitations.md SS1). What deliberately REMAINS out of scope: the
// dealer still generates the salts and therefore still SEES every card -
// hiding cards from the dealer is mental-poker/MPC territory (deck v2).
//
// Deck: real Coup - 15 cards, 3 copies of each of the 5 characters (ids
// 0..4). CANONICAL[i] = i / 3, i in [0,15). Supports the referee's full 2-4
// player range (up to 8 cards dealt; the rest stay burned/undealt).
//
// Public inputs (fixed order): [seed, leaf_0, ..., leaf_14]  (16 fields).
//   - `seed`: the referee's own stored commit-reveal seed (both players'
//     nonces folded, exactly like the liars-dice referee's) - the referee
//     rebuilds public_inputs from ITS stored seed, so a proof minted for a
//     different seed is rejected (ADR 004 binding invariant).
//   - `leaf_i = Poseidon2(card_at_position_i, salt_i)`: the same per-card
//     commitment shape `card_membership` already proves against, so
//     downstream "prove-hold-or-bluff" works on dealt leaves unchanged.
// Private witness: perm[15] (position i holds card CANONICAL[perm[i]]),
//   salt[15].
//
// Proves:
//   1. `perm` is a bijection over [0,15): every entry in range AND pairwise
//      distinct (O(N^2) inequality products - trivial at N=15).
//   2. Every public leaf opens correctly:
//      leaf_i == Poseidon2(CANONICAL[perm[i]], salt_i).
//   3. THE FAIRNESS CORE - the order is forced by the seed: with sort keys
//      k_j = Poseidon2(seed, j) for source index j, the permutation must
//      list source indices in strictly ascending (truncated) key order:
//      trunc64(k[perm[i]]) < trunc64(k[perm[i+1]]). Keys are
//      indistinguishable from uniform, so exactly one permutation satisfies
//      this (ties in the low 64 bits have probability ~2^-57 across 15
//      keys) - the dealer cannot choose the order at all, only learn it.
//
// trunc64 (low 64 bits of the Poseidon2 key) is part of the protocol
// definition and MUST match the off-chain derivation in `zktable-graph
// shuffle-witness` byte-for-byte - both sides sort by `key mod 2^64`.
//
// hash2 == Barretenberg/Noir Poseidon2 over 2 inputs, byte-identical to the
// off-chain `zktable-graph` tool (soroban-poseidon `poseidon2_hash`) and the
// on-chain referee's `poseidon2_hash2` - the same scheme every other zkTable
// circuit uses in production.
use dep::poseidon::poseidon2::Poseidon2;

// Deck size: 3 copies x 5 characters, real Coup.
global N: u32 = 15;

// CANONICAL[i] = i / 3 - the fixed, public deck contents before shuffling.
global CANONICAL: [Field; N] = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4];

fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

pub fn main(seed: pub Field, leaf: pub [Field; N], perm: [u32; N], salt: [Field; N]) {
    // 1. Bijection over [0, N): range check each entry, then pairwise
    //    distinctness (perm[i] != perm[j] for all i < j).
    for i in 0..N {
        assert(perm[i] < N);
    }
    for i in 0..N {
        for j in (i + 1)..N {
            assert(perm[i] != perm[j]);
        }
    }

    // 2. Every public leaf commits the canonical card at its permuted source
    //    slot: leaf_i = Poseidon2(CANONICAL[perm[i]], salt_i).
    for i in 0..N {
        assert(hash2(CANONICAL[perm[i]], salt[i]) == leaf[i]);
    }

    // 3. Seed-forced order: source indices must appear in strictly ascending
    //    truncated-key order, where k_j = Poseidon2(seed, j).
    let mut keys: [u64; N] = [0; N];
    for j in 0..N {
        let k = hash2(seed, j as Field);
        // Protocol-defined truncation: sort by the key's low 64 bits.
        keys[j] = k as u64;
    }
    for i in 0..(N - 1) {
        assert(keys[perm[i]] < keys[perm[i + 1]]);
    }
}

// --- test helpers ------------------------------------------------------

// Recomputes the unique seed-forced permutation + matching leaves for a
// given seed and salts - the same derivation `zktable-graph
// shuffle-witness` performs off-chain.
fn derive_shuffle(seed: Field, salt: [Field; N]) -> ([u32; N], [Field; N]) {
    let mut keys: [u64; N] = [0; N];
    for j in 0..N {
        keys[j] = hash2(seed, j as Field) as u64;
    }
    // Selection sort of source indices by key (test-only, unconstrained cost).
    let mut perm: [u32; N] = [0; N];
    let mut used: [bool; N] = [false; N];
    for i in 0..N {
        let mut best: u32 = 0;
        let mut found = false;
        for j in 0..N {
            if !used[j] {
                if !found {
                    best = j;
                    found = true;
                } else if keys[j] < keys[best] {
                    best = j;
                }
            }
        }
        perm[i] = best;
        used[best] = true;
    }
    let mut leaf: [Field; N] = [0; N];
    for i in 0..N {
        leaf[i] = hash2(CANONICAL[perm[i]], salt[i]);
    }
    (perm, leaf)
}

fn test_salts() -> [Field; N] {
    [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]
}

#[test]
fn test_honest_shuffle_passes() {
    let seed = 424242;
    let salt = test_salts();
    let (perm, leaf) = derive_shuffle(seed, salt);
    main(seed, leaf, perm, salt);
}

#[test(should_fail)]
fn test_non_bijection_fails() {
    let seed = 424242;
    let salt = test_salts();
    let (mut perm, mut leaf) = derive_shuffle(seed, salt);
    // Duplicate one source slot (stack the deck with two copies of the same
    // source card) - fails pairwise distinctness.
    perm[1] = perm[0];
    leaf[1] = hash2(CANONICAL[perm[1]], salt[1]);
    main(seed, leaf, perm, salt);
}

#[test(should_fail)]
fn test_wrong_order_fails() {
    let seed = 424242;
    let salt = test_salts();
    let (mut perm, mut leaf) = derive_shuffle(seed, salt);
    // A perfectly valid bijection with correct leaves - but NOT the
    // seed-forced order (dealer tried to choose who gets what).
    let tmp = perm[0];
    perm[0] = perm[1];
    perm[1] = tmp;
    leaf[0] = hash2(CANONICAL[perm[0]], salt[0]);
    leaf[1] = hash2(CANONICAL[perm[1]], salt[1]);
    main(seed, leaf, perm, salt);
}

#[test(should_fail)]
fn test_wrong_salt_fails() {
    let seed = 424242;
    let salt = test_salts();
    let (perm, leaf) = derive_shuffle(seed, salt);
    let mut bad_salt = salt;
    bad_salt[3] = 999999;
    main(seed, leaf, perm, bad_salt);
}

#[test(should_fail)]
fn test_wrong_seed_fails() {
    // Proof material derived for one seed must not satisfy another seed's
    // public input (the referee rebuilds public_inputs from ITS stored seed).
    let salt = test_salts();
    let (perm, leaf) = derive_shuffle(424242, salt);
    main(777777, leaf, perm, salt);
}
