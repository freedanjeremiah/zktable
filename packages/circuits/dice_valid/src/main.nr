// zkTable `dice` module - hidden, provably-fair dice for Liar's Dice.
//
// Proves a player's N=5 hidden dice are (1) committed, (2) valid faces in
// {1,...,6}, and (3) the canonical, in-circuit-bound reduction of a per-die
// hash derived from a PUBLIC shared seed and the player's id - so the roll is
// unforgeable: it is fixed the moment the seed is fixed, before any die value
// is revealed, and the circuit itself (not just an off-chain check) enforces
// that binding.
//
// Commitments:  c_j = Poseidon2(d_j, salt_j)                    (hash2)
// Per-die hash: H_j = Poseidon2(Poseidon2(seed, player_id), j)   (hash2 twice)
// Fair value:   d_j = canonical_reduce_1_to_6(H_j)
//
// hash2 == Barretenberg/Noir Poseidon2 over 2 inputs, which the off-chain
// dice tool (soroban-poseidon `poseidon2_hash`) reproduces exactly - the same
// scheme the `board` module (move_along) already uses in production.
use dep::poseidon::poseidon2::Poseidon2;

// Fixed roll size and die sides. Public-input layout below assumes N = 5.
global N: u32 = 5;
global SIDES: Field = 6;

// floor((p-1)/6) for the BN254 scalar field
//   p = 21888242871839275222246405745257275088548364400416034343698204186575808495617.
// This is the maximum possible integer value of the TRUE quotient
// q = H_j / 6 (integer division) for any H_j in [0, p-1]. It bounds the
// canonicality check in `constrain_fair_die` below.
global Q_MAX: Field = 3648040478639879203707734290876212514758060733402672390616367364429301415936;

// Q_MAX fits in 252 bits, and 2 * 2^252 < p (p has 254 bits), so a two-sided
// 252-bit range check on q is sound with no field-wraparound ambiguity - see
// `constrain_fair_die` and the report for the full argument.
global Q_BITS: u32 = 252;

fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

// Enforce that `die` is the CANONICAL reduction of `h` into {1,...,SIDES}
// (SIDES fixed at 6): h == q*SIDES + r as integers, 0 <= r <= SIDES-1,
// die == r + 1. Field arithmetic alone (h == q*SIDES + r as a Field equation)
// admits SIDES possible (q, r) solutions - one per residue r in {0..5} - since
// SIDES is coprime to the prime field order p. Only one of those solutions has
// q in the "true" integer-division range [0, Q_MAX]; the other SIDES-1 wrap
// the field and land on q values that require far more than Q_BITS bits. The
// two-sided range check below (q bounded AND Q_MAX - q bounded, both to
// Q_BITS bits, with 2*2^Q_BITS < p) admits only the true, unwrapped solution.
fn constrain_fair_die(h: Field, q: Field, r: Field, die: Field) {
    // r in {0,...,5}: direct product constraint (SIDES is a small compile-time
    // constant, so no general range gadget is needed).
    assert(r * (r - 1) * (r - 2) * (r - 3) * (r - 4) * (r - 5) == 0);
    // Euclidean relation h = q*6 + r (checked as a Field equation).
    assert(h == q * SIDES + r);
    // Canonicality: pin q into the integer range [0, Q_MAX], ruling out every
    // field-wrapped alternative (q, r) pair.
    q.assert_max_bit_size::<Q_BITS>();
    (Q_MAX - q).assert_max_bit_size::<Q_BITS>();
    // Face value.
    assert(die == r + 1);
}

pub fn main(
    seed: pub Field,
    player_id: pub Field,
    c: pub [Field; N],
    d: [Field; N],
    salt: [Field; N],
    q: [Field; N],
    r: [Field; N],
) {
    // Bind every per-die hash to the public (seed, player_id) pair once.
    let seed_player = hash2(seed, player_id);

    for j in 0..N {
        let dj = d[j];

        // 1. Commitment: the hidden die and salt open the public commitment.
        assert(hash2(dj, salt[j]) == c[j]);

        // 2. Valid die: dj in {1,...,6} (direct product constraint).
        assert((dj - 1) * (dj - 2) * (dj - 3) * (dj - 4) * (dj - 5) * (dj - 6) == 0);

        // 3. Fair derivation: dj is the canonical reduction into [1,6] of the
        //    per-die hash H_j, which is itself recomputed in-circuit from the
        //    public seed, player_id, and loop index j. This is what makes the
        //    committed roll unforgeable: it is fully determined by (seed,
        //    player_id, j) before any salt or commitment is chosen.
        let h = hash2(seed_player, j as Field);
        constrain_fair_die(h, q[j], r[j], dj);
    }
}

#[test]
fn test_smoke() {
    // Sanity: a commitment round-trips, and the canonical reduction of a
    // small concrete hash lands where expected. (Full end-to-end derivation
    // is exercised by the Rust witness tool + `nargo execute` + `bb prove`,
    // which control the seed and match the off-chain hash byte-for-byte.)
    let c = hash2(7, 42);
    assert(c == hash2(7, 42));

    // h = 6*3 + 4 = 22 -> r = 4, die = 5.
    constrain_fair_die(22, 3, 4, 5);
}
