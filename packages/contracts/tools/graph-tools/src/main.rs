//! zkTable off-chain `board` + `dice` builder.
//!
//! `board` (move_along) commands:
//!   root    --graph G                         print the edge-tree root (hex)
//!   commit  --node N --salt S                 print Poseidon2(node, salt) (hex)
//!           (also accepts --value/--salt, shared with the `dice` commit below)
//!   witness --graph G --from A --to B --ticket T --salt-old S1 --salt-new S2
//!           --prover P.toml --json OUT.json   emit the move_along witness
//!
//! `dice` (dice_valid) commands:
//!   seed          --nonces a,b,c                     print the joint seed (hex)
//!   commit        --value V --salt S                 print Poseidon2(value, salt) (hex)
//!   dice-witness  --seed S --player P --salts s0,..,s4 [--dice d0,..,d4]
//!                 --prover P.toml --json OUT.json     emit the dice_valid witness
//!
//! All hashing uses soroban-poseidon `poseidon2_hash::<4, BnScalar>`, identical
//! to the Noir circuits' `Poseidon2::hash([a,b],2)` and the on-chain referee.

use num_bigint::BigUint;
use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{crypto::BnScalar, Bytes, Env, Vec as SorobanVec, U256};
use std::collections::HashMap;

const TREE_DEPTH: usize = 10;
const N_LEAVES: usize = 1 << TREE_DEPTH;

// dice_valid: fixed roll size and die sides, matching the circuit's `N`/`SIDES`.
const DICE_N: usize = 5;
const DICE_SIDES: u32 = 6;

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

// ---------- dice ----------

/// Joint seed = left-fold of hash2 over the announced nonces, starting from
/// the field element 0: seed = hash2(hash2(hash2(0, n0), n1), n2), ... This is
/// exactly what the `dice-witness`/circuit derivation calls `seed`; any party
/// can recompute it from the public nonce list and get the same value.
fn fold_seed(env: &Env, nonces: &[BigUint]) -> BigUint {
    let mut acc = BigUint::from(0u32);
    for n in nonces {
        acc = hash2(env, &acc, n);
    }
    acc
}

/// The canonical reduction of a per-die hash `h` (h in [0, p-1], as produced
/// by hash2) into a die face in {1,...,6}: q = h / 6, r = h % 6 (true integer
/// division), die = r + 1. This is the SAME reduction the `dice_valid` circuit
/// enforces in-circuit via `constrain_fair_die` (see the circuit source and
/// report for the full canonicality argument) - the tool and circuit must
/// agree bit-for-bit on q, r, die for a given h.
fn reduce_die(h: &BigUint) -> (BigUint, BigUint, BigUint) {
    let sides = BigUint::from(DICE_SIDES);
    let q = h / &sides;
    let r = h % &sides;
    let die = &r + BigUint::from(1u32);
    (q, r, die)
}

/// Per-die hash H_j = hash2(hash2(seed, player_id), j), matching the
/// circuit's `seed_player = hash2(seed, player_id); h = hash2(seed_player, j)`.
fn dice_hash(env: &Env, seed: &BigUint, player_id: &BigUint, j: u64) -> BigUint {
    let seed_player = hash2(env, seed, player_id);
    hash2(env, &seed_player, &BigUint::from(j))
}

fn parse_big_list(env: &Env, raw: &str) -> Vec<BigUint> {
    raw.split(',').map(|s| parse_field_str(s) % modulus(env)).collect()
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
/// Parse a Field either as decimal ("123") or 0x-prefixed hex ("0xabc..").
fn parse_field_str(s: &str) -> BigUint {
    let s = s.trim();
    if let Some(h) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")) {
        BigUint::parse_bytes(h.as_bytes(), 16).unwrap_or_else(|| panic!("invalid hex Field '{s}'"))
    } else {
        BigUint::parse_bytes(s.as_bytes(), 10).unwrap_or_else(|| panic!("invalid decimal Field '{s}'"))
    }
}
fn arg_big(env: &Env, args: &HashMap<String, String>, k: &str) -> BigUint {
    parse_field_str(&arg(args, k)) % modulus(env)
}
fn arg_opt(args: &HashMap<String, String>, k: &str) -> Option<String> {
    args.get(k).cloned()
}
/// Like `arg_big`, but tries `k` first, falling back to `alt` (used so
/// `commit` accepts either --node/--salt (board) or --value/--salt (dice)).
fn arg_big_alt(env: &Env, args: &HashMap<String, String>, k: &str, alt: &str) -> BigUint {
    let raw = args.get(k).or_else(|| args.get(alt)).unwrap_or_else(|| panic!("missing --{k}/--{alt}")).clone();
    parse_field_str(&raw) % modulus(env)
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
            // Accepts --node/--salt (board) or --value/--salt (dice) - same
            // hash2 either way.
            let value = arg_big_alt(&env, &flags, "node", "value");
            let salt = arg_big(&env, &flags, "salt");
            println!("{}", hex(&hash2(&env, &value, &salt)));
        }
        "seed" => {
            let nonces = parse_big_list(&env, &arg(&flags, "nonces"));
            let seed = fold_seed(&env, &nonces);
            println!("{}", hex(&seed));
        }
        "dice-witness" => {
            let seed = arg_big(&env, &flags, "seed");
            let player_id = arg_big(&env, &flags, "player");
            let salts = parse_big_list(&env, &arg(&flags, "salts"));
            assert_eq!(salts.len(), DICE_N, "--salts must list exactly {DICE_N} values");
            let dice_override = arg_opt(&flags, "dice").map(|s| parse_big_list(&env, &s));
            if let Some(ref d) = dice_override {
                assert_eq!(d.len(), DICE_N, "--dice must list exactly {DICE_N} values");
            }

            let mut dice = Vec::with_capacity(DICE_N);
            let mut qs = Vec::with_capacity(DICE_N);
            let mut rs = Vec::with_capacity(DICE_N);
            let mut commitments = Vec::with_capacity(DICE_N);
            for j in 0..DICE_N {
                let h = dice_hash(&env, &seed, &player_id, j as u64);
                let (q, r, derived_die) = reduce_die(&h);
                // The fair, derived die - unless --dice explicitly overrides it
                // (e.g. to build an intentionally-invalid witness for a
                // negative/tamper test: q,r still come from the TRUE
                // derivation, so an override that disagrees with `r + 1`
                // will fail the circuit's `assert(die == r + 1)`).
                let die = dice_override
                    .as_ref()
                    .map(|d| d[j].clone())
                    .unwrap_or_else(|| derived_die.clone());
                let c = hash2(&env, &die, &salts[j]);
                dice.push(die);
                qs.push(q);
                rs.push(r);
                commitments.push(c);
            }

            // Prover.toml (decimal Field strings).
            let mut toml = String::new();
            toml.push_str(&format!("seed = \"{}\"\n", seed));
            toml.push_str(&format!("player_id = \"{}\"\n", player_id));
            toml.push_str(&toml_list("c", &commitments.iter().map(|v| v.to_string()).collect::<Vec<_>>()));
            toml.push_str(&toml_list("d", &dice.iter().map(|v| v.to_string()).collect::<Vec<_>>()));
            toml.push_str(&toml_list("salt", &salts.iter().map(|v| v.to_string()).collect::<Vec<_>>()));
            toml.push_str(&toml_list("q", &qs.iter().map(|v| v.to_string()).collect::<Vec<_>>()));
            toml.push_str(&toml_list("r", &rs.iter().map(|v| v.to_string()).collect::<Vec<_>>()));
            std::fs::write(arg(&flags, "prover"), toml).expect("write Prover.toml");

            // public_inputs blob = seed | player_id | c_0 | .. | c_4 (7*32
            // bytes), the exact circuit public-input order (`main`'s
            // parameter order: seed, player_id, c[5]).
            let mut pub_blob = Vec::with_capacity(32 * (2 + DICE_N));
            pub_blob.extend_from_slice(&be32(&seed));
            pub_blob.extend_from_slice(&be32(&player_id));
            for c in &commitments {
                pub_blob.extend_from_slice(&be32(c));
            }
            let pub_hex = {
                let mut s = String::from("0x");
                for b in &pub_blob {
                    s.push_str(&format!("{:02x}", b));
                }
                s
            };
            let json = serde_json::json!({
                "seed": hex(&seed),
                "player_id": player_id.to_string(),
                "dice": dice.iter().map(|d| d.to_string()).collect::<Vec<_>>(),
                "commitments": commitments.iter().map(hex).collect::<Vec<_>>(),
                "public_inputs": pub_hex,
            });
            std::fs::write(arg(&flags, "json"), serde_json::to_string_pretty(&json).unwrap())
                .expect("write json");
            eprintln!(
                "dice witness written: seed={} player={} dice={:?}",
                hex(&seed),
                player_id,
                dice.iter().map(|d| d.to_string()).collect::<Vec<_>>()
            );
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
            eprintln!(
                "unknown command '{other}'. use: root | commit | witness | seed | dice-witness"
            );
            std::process::exit(2);
        }
    }
}
