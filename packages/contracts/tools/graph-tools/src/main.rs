//! zkTable off-chain `board` builder.
//!
//! Commands:
//!   root    --graph G                         print the edge-tree root (hex)
//!   commit  --node N --salt S                 print Poseidon2(node, salt) (hex)
//!   witness --graph G --from A --to B --ticket T --salt-old S1 --salt-new S2
//!           --prover P.toml --json OUT.json   emit the move_along witness
//!
//! All hashing uses soroban-poseidon `poseidon2_hash::<4, BnScalar>`, identical
//! to the Noir circuit's `Poseidon2::hash([a,b],2)` and the on-chain referee.

use num_bigint::BigUint;
use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{crypto::BnScalar, Bytes, Env, Vec as SorobanVec, U256};
use std::collections::HashMap;

const TREE_DEPTH: usize = 10;
const N_LEAVES: usize = 1 << TREE_DEPTH;

// ---------- field helpers ----------

fn be32(x: &BigUint) -> [u8; 32] {
    let mut be = x.to_bytes_be();
    if be.len() > 32 {
        be = be[be.len() - 32..].to_vec();
    }
    let mut out = [0u8; 32];
    out[32 - be.len()..].copy_from_slice(&be);
    out
}

fn hex(x: &BigUint) -> String {
    let mut s = String::from("0x");
    for b in be32(x) {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn modulus(env: &Env) -> BigUint {
    let m = <BnScalar as Field>::modulus(env);
    let mut arr = [0u8; 32];
    m.to_be_bytes().copy_into_slice(&mut arr);
    BigUint::from_bytes_be(&arr)
}

/// Poseidon2 2-to-1 hash, byte-identical to the Noir circuit and the referee.
fn hash2(env: &Env, a: &BigUint, b: &BigUint) -> BigUint {
    let a_bytes = Bytes::from_array(env, &be32(a));
    let b_bytes = Bytes::from_array(env, &be32(b));
    let m = <BnScalar as Field>::modulus(env);
    let mut inputs = SorobanVec::new(env);
    inputs.push_back(U256::from_be_bytes(env, &a_bytes).rem_euclid(&m));
    inputs.push_back(U256::from_be_bytes(env, &b_bytes).rem_euclid(&m));
    let out = poseidon2_hash::<4, BnScalar>(env, &inputs);
    let mut out_arr = [0u8; 32];
    out.to_be_bytes().copy_into_slice(&mut out_arr);
    BigUint::from_bytes_be(&out_arr)
}

fn edge_leaf(env: &Env, from: &BigUint, to: &BigUint, ticket: &BigUint) -> BigUint {
    let ft = hash2(env, from, to);
    hash2(env, &ft, ticket)
}

// ---------- graph / tree ----------

#[derive(serde::Deserialize)]
struct EdgeJson {
    from: u64,
    to: u64,
    ticket: u64,
}
#[derive(serde::Deserialize)]
struct GraphJson {
    #[serde(default)]
    nodes: Vec<u64>,
    edges: Vec<EdgeJson>,
    /// If true, each listed edge is expanded to both directions (default true).
    #[serde(default = "default_true")]
    bidirectional: bool,
}
fn default_true() -> bool {
    true
}

/// Canonical directed edge list: expand bidirectional, dedupe, sort. Both the
/// off-chain tree and the on-chain root MUST derive from this exact ordering.
fn canonical_edges(g: &GraphJson) -> Vec<(u64, u64, u64)> {
    let mut set: Vec<(u64, u64, u64)> = Vec::new();
    for e in &g.edges {
        set.push((e.from, e.to, e.ticket));
        if g.bidirectional {
            set.push((e.to, e.from, e.ticket));
        }
    }
    set.sort_unstable();
    set.dedup();
    set
}

/// Build the full depth-10 Merkle tree; return (levels, edge_index_map, root).
/// levels[0] = leaves (padded with 0). levels[TREE_DEPTH] = [root].
fn build_tree(
    env: &Env,
    edges: &[(u64, u64, u64)],
) -> (Vec<Vec<BigUint>>, HashMap<(u64, u64, u64), usize>, BigUint) {
    assert!(edges.len() <= N_LEAVES, "too many edges for TREE_DEPTH");
    let mut index_map = HashMap::new();
    let mut leaves: Vec<BigUint> = Vec::with_capacity(N_LEAVES);
    for (i, e) in edges.iter().enumerate() {
        index_map.insert(*e, i);
        leaves.push(edge_leaf(
            env,
            &BigUint::from(e.0),
            &BigUint::from(e.1),
            &BigUint::from(e.2),
        ));
    }
    while leaves.len() < N_LEAVES {
        leaves.push(BigUint::from(0u32)); // empty leaf = field zero
    }
    let mut levels: Vec<Vec<BigUint>> = vec![leaves];
    for d in 0..TREE_DEPTH {
        let prev = &levels[d];
        let mut next = Vec::with_capacity(prev.len() / 2);
        let mut i = 0;
        while i < prev.len() {
            next.push(hash2(env, &prev[i], &prev[i + 1]));
            i += 2;
        }
        levels.push(next);
    }
    let root = levels[TREE_DEPTH][0].clone();
    (levels, index_map, root)
}

/// Authentication path for leaf `idx`: (siblings, bits). bit=0 -> node is left.
fn merkle_path(levels: &[Vec<BigUint>], idx: usize) -> (Vec<BigUint>, Vec<u8>) {
    let mut siblings = Vec::with_capacity(TREE_DEPTH);
    let mut bits = Vec::with_capacity(TREE_DEPTH);
    let mut pos = idx;
    for d in 0..TREE_DEPTH {
        let bit = (pos & 1) as u8;
        let sib = if bit == 0 { pos + 1 } else { pos - 1 };
        siblings.push(levels[d][sib].clone());
        bits.push(bit);
        pos >>= 1;
    }
    (siblings, bits)
}

// ---------- arg parsing ----------

fn arg(args: &HashMap<String, String>, k: &str) -> String {
    args.get(k)
        .unwrap_or_else(|| panic!("missing --{k}"))
        .clone()
}
fn arg_u64(args: &HashMap<String, String>, k: &str) -> u64 {
    arg(args, k).parse().unwrap_or_else(|_| panic!("--{k} must be a u64"))
}
fn arg_big(env: &Env, args: &HashMap<String, String>, k: &str) -> BigUint {
    let raw = arg(args, k);
    let v = BigUint::parse_bytes(raw.as_bytes(), 10).unwrap_or_else(|| panic!("--{k} must be decimal"));
    v % modulus(env)
}

fn parse_flags(rest: &[String]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut i = 0;
    while i < rest.len() {
        let k = rest[i].trim_start_matches("--").to_string();
        let v = rest.get(i + 1).cloned().unwrap_or_default();
        m.insert(k, v);
        i += 2;
    }
    m
}

fn load_graph(path: &str) -> GraphJson {
    let s = std::fs::read_to_string(path).unwrap_or_else(|_| panic!("cannot read graph {path}"));
    serde_json::from_str(&s).expect("invalid graph JSON")
}

fn toml_list(label: &str, vals: &[String]) -> String {
    let items: Vec<String> = vals.iter().map(|v| format!("\"{v}\"")).collect();
    format!("{label} = [{}]\n", items.join(", "))
}

fn main() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let argv: Vec<String> = std::env::args().collect();
    let cmd = argv.get(1).cloned().unwrap_or_default();
    let flags = parse_flags(&argv[2.min(argv.len())..]);

    match cmd.as_str() {
        "root" => {
            let g = load_graph(&arg(&flags, "graph"));
            let edges = canonical_edges(&g);
            let (_, _, root) = build_tree(&env, &edges);
            println!("{}", hex(&root));
        }
        "commit" => {
            let node = arg_big(&env, &flags, "node");
            let salt = arg_big(&env, &flags, "salt");
            println!("{}", hex(&hash2(&env, &node, &salt)));
        }
        "witness" => {
            let g = load_graph(&arg(&flags, "graph"));
            let edges = canonical_edges(&g);
            let (levels, index_map, root) = build_tree(&env, &edges);

            let from = arg_u64(&flags, "from");
            let to = arg_u64(&flags, "to");
            let ticket = arg_u64(&flags, "ticket");
            let salt_old = arg_big(&env, &flags, "salt-old");
            let salt_new = arg_big(&env, &flags, "salt-new");

            let idx = *index_map
                .get(&(from, to, ticket))
                .unwrap_or_else(|| panic!("edge ({from},{to},ticket={ticket}) not in graph"));
            let (siblings, bits) = merkle_path(&levels, idx);

            let from_f = BigUint::from(from);
            let to_f = BigUint::from(to);
            let ticket_f = BigUint::from(ticket);
            let c_old = hash2(&env, &from_f, &salt_old);
            let c_new = hash2(&env, &to_f, &salt_new);

            // Prover.toml (decimal Field strings).
            let mut toml = String::new();
            toml.push_str(&format!("c_old = \"{}\"\n", c_old));
            toml.push_str(&format!("c_new = \"{}\"\n", c_new));
            toml.push_str(&format!("ticket = \"{}\"\n", ticket_f));
            toml.push_str(&format!("root = \"{}\"\n", root));
            toml.push_str(&format!("from = \"{}\"\n", from_f));
            toml.push_str(&format!("salt_old = \"{}\"\n", salt_old));
            toml.push_str(&format!("to = \"{}\"\n", to_f));
            toml.push_str(&format!("salt_new = \"{}\"\n", salt_new));
            toml.push_str(&toml_list(
                "path_siblings",
                &siblings.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            ));
            toml.push_str(&toml_list(
                "path_bits",
                &bits.iter().map(|b| b.to_string()).collect::<Vec<_>>(),
            ));
            std::fs::write(arg(&flags, "prover"), toml).expect("write Prover.toml");

            // public_inputs blob = c_old | c_new | ticket | root (128 bytes), the
            // exact order the referee reconstructs and the verifier expects.
            let mut pub_blob = Vec::with_capacity(128);
            for v in [&c_old, &c_new, &ticket_f, &root] {
                pub_blob.extend_from_slice(&be32(v));
            }
            let pub_hex = {
                let mut s = String::from("0x");
                for b in &pub_blob {
                    s.push_str(&format!("{:02x}", b));
                }
                s
            };
            let json = serde_json::json!({
                "root": hex(&root),
                "c_old": hex(&c_old),
                "c_new": hex(&c_new),
                "ticket": ticket,
                "edge_index": idx,
                "public_inputs": pub_hex,
            });
            std::fs::write(arg(&flags, "json"), serde_json::to_string_pretty(&json).unwrap())
                .expect("write json");
            eprintln!("witness written: edge_index={idx} root={}", hex(&root));
        }
        other => {
            eprintln!("unknown command '{other}'. use: root | commit | witness");
            std::process::exit(2);
        }
    }
}
