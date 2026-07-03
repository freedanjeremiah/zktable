// zkTable `deck` module - Coup-lite "prove-hold-or-bluff": prove a claimed
// character card really is one of the two cards in a player's hidden hand,
// without revealing the hand's contents (which card is which, or which slot
// is the claimed one).
//
// HONEST SIMPLIFICATION (PRD SS7.2 / M6.3 brief): this is deck v1, NOT full
// mental-poker/coSNARK dealing security. The hand is committed by a
// semi-honest dealer/orchestrator off-chain (see the coup-referee's `deal`
// phase and its module doc) - this circuit does not prove the deal itself
// came from a valid shuffle (that would be a `valid_shuffle` circuit, out of
// scope for v1, documented as future work). What IS proven, and IS
// load-bearing: given a player's two already-committed hand cards, the
// claimed character genuinely sits in that hand. This is exactly the "hold"
// half of Coup's "prove-hold-or-bluff" - a player who is bluffing (the
// claimed card is not in their hand) cannot produce a satisfying witness for
// ANY `held_index`, so on challenge they must fall back to revealing a real
// card instead (the referee's `reveal_card`) and lose influence.
//
// Hand size H = 2 (Coup: each player holds exactly 2 influence cards).
// Per-card commitments: c_i = Poseidon2(card_i, salt_i)  (hash2), i in {0,1}.
//
// Public inputs (fixed order): [claimed_card, c_0, c_1]  (3 fields).
// Private witness: card[2], salt[2], held_index (0 or 1, selects which hand
// slot equals the public claim).
//
// Proves:
//   1. BOTH hand cards open their public commitments: hash2(card[i], salt[i])
//      == c_i for i in {0,1}. (Knowledge of the full, real hand contents -
//      not just the claimed card - so a prover cannot fabricate a
//      single-card "hand" that happens to match the claim.)
//   2. held_index in {0,1} (a real slot selector, not an out-of-range value).
//   3. The card at the selected slot equals the public claimed_card:
//      card[held_index] == claimed_card. (Since H=2, this selection is done
//      with a direct linear combination rather than a general selector
//      gadget - see `select` below.)
//
// hash2 == Barretenberg/Noir Poseidon2 over 2 inputs, byte-identical to the
// off-chain `zktable-graph` tool (soroban-poseidon `poseidon2_hash`) and the
// on-chain referee's `poseidon2_hash2` - the same scheme `board`/`dice`
// already use in production.
use dep::poseidon::poseidon2::Poseidon2;

// Fixed hand size. Public-input layout below assumes H = 2.
global H: u32 = 2;

fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

// Linear-combination select over exactly 2 elements: held_index == 0 -> a[0],
// held_index == 1 -> a[1]. Sound ONLY given the caller has already
// constrained held_index * (held_index - 1) == 0 (see `main` below) - this
// function performs no range check of its own.
fn select2(a: [Field; H], held_index: Field) -> Field {
    a[0] + held_index * (a[1] - a[0])
}

pub fn main(
    claimed_card: pub Field,
    c: pub [Field; H],
    card: [Field; H],
    salt: [Field; H],
    held_index: Field,
) {
    // 1. Both hand cards open their public commitments - proves knowledge of
    //    the REAL committed hand, not just a single fabricated card.
    for i in 0..H {
        assert(hash2(card[i], salt[i]) == c[i]);
    }

    // 2. held_index is a genuine slot selector (0 or 1), not an
    //    out-of-range/wrapped value.
    assert(held_index * (held_index - 1) == 0);

    // 3. The selected hand slot really holds the claimed character.
    let selected = select2(card, held_index);
    assert(selected == claimed_card);
}

#[test]
fn test_smoke() {
    // Sanity: a commitment round-trips, and select2 picks the right slot.
    let c0 = hash2(2, 11);
    assert(c0 == hash2(2, 11));
    assert(select2([2, 4], 0) == 2);
    assert(select2([2, 4], 1) == 4);
}

#[test]
fn test_hold_valid() {
    // Hand = [Duke(=1), Assassin(=3)], held_index = 1 -> claiming Assassin.
    let card = [1, 3];
    let salt = [11, 22];
    let c = [hash2(card[0], salt[0]), hash2(card[1], salt[1])];
    main(3, c, card, salt, 1);
}

#[test(should_fail)]
fn test_bluff_fails() {
    // Hand does not contain the claimed character (Contessa = 4) at all -
    // no held_index makes `select2(card, held_index) == claimed_card` hold.
    let card = [1, 3];
    let salt = [11, 22];
    let c = [hash2(card[0], salt[0]), hash2(card[1], salt[1])];
    main(4, c, card, salt, 0);
}
