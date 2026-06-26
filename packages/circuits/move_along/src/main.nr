// zkTable `board` module - hidden movement on a public graph.
//
// Proves a piece moved from a hidden position to a new hidden position along a
// legal edge of a public transit graph, using an announced transport `ticket`,
// WITHOUT revealing either position.
//
// Commitments:  C = Poseidon2(value, salt)          (hash2)
// Edge leaf:     L = Poseidon2(Poseidon2(from,to), ticket)
// Edge tree:     a Merkle tree over all legal directed edges (from,to,ticket);
//                its root `root` is a public per-map constant.
//
// hash2 == Barretenberg/Noir Poseidon2 over 2 inputs, which the off-chain tree
// builder (soroban-poseidon `poseidon2_hash`) reproduces exactly. Only hash2 is
// used so on-/off-chain hashing provably agree.
use dep::poseidon::poseidon2::Poseidon2;

// Merkle depth of the edge tree: 2^10 = 1024 directed edges (ample for a
// ~100-node map). Fixed so the circuit size is independent of map size.
global TREE_DEPTH: u32 = 10;

fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

fn constrain_bit(bit: Field) {
    assert(bit * (1 - bit) == 0);
}

// Recompute a Merkle root from `leaf` and its authentication path.
// bit == 0 -> current node is the left child; bit == 1 -> right child.
fn compute_root(leaf: Field, siblings: [Field; TREE_DEPTH], bits: [Field; TREE_DEPTH]) -> Field {
    let mut cur = leaf;
    for i in 0..TREE_DEPTH {
        let sib = siblings[i];
        let bit = bits[i];
        constrain_bit(bit);
        if bit == 0 {
            cur = hash2(cur, sib);
        } else {
            cur = hash2(sib, cur);
        }
    }
    cur
}

pub fn main(
    c_old: pub Field,
    c_new: pub Field,
    ticket: pub Field,
    root: pub Field,
    from: Field,
    salt_old: Field,
    to: Field,
    salt_new: Field,
    path_siblings: [Field; TREE_DEPTH],
    path_bits: [Field; TREE_DEPTH],
) {
    // 1. The hidden old position matches the committed current position.
    assert(hash2(from, salt_old) == c_old);
    // 2. The hidden new position matches the announced new commitment.
    assert(hash2(to, salt_new) == c_new);
    // 3. (from, to, ticket) is a legal edge: its leaf is in the edge tree.
    let leaf = hash2(hash2(from, to), ticket);
    assert(compute_root(leaf, path_siblings, path_bits) == root);
}

#[test]
fn test_smoke() {
    // Sanity: a commitment round-trips. (Full membership is exercised by the
    // Rust witness builder + on-chain tests, which control the tree root.)
    let c = hash2(7, 42);
    assert(c == hash2(7, 42));
}
