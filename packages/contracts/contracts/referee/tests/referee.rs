//! Native (Soroban test host) tests for the referee contract.
//!
//! These tests register a real `zktable-verifier` instance loaded with the
//! `move_along` circuit's VK and drive real proofs through a cross-contract
//! call, proving the referee's ZK binding (public_inputs built from its own
//! stored `c_old`/`graph_root`, never client-supplied values).

use soroban_env_host::DiagnosticLevel;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec as SorobanVec,
};
use zktable_referee::{Error, GameState, RefereeContract, RefereeContractClient, Status};
use zktable_verifier::UltraHonkVerifierContract;

const VK_BIN: &[u8] = include_bytes!("fixtures/move_along_vk");
const PROOF_BIN: &[u8] = include_bytes!("fixtures/move_along_proof");
const PUB_INPUTS_BIN: &[u8] = include_bytes!("fixtures/move_along_public_inputs");

// ---------- fixture helpers ----------

fn fixture_c_old(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    a.copy_from_slice(&PUB_INPUTS_BIN[0..32]);
    BytesN::from_array(env, &a)
}

fn fixture_c_new(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    a.copy_from_slice(&PUB_INPUTS_BIN[32..64]);
    BytesN::from_array(env, &a)
}

fn fixture_root(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    a.copy_from_slice(&PUB_INPUTS_BIN[96..128]);
    BytesN::from_array(env, &a)
}

/// Commitment for (node=5, salt=12345), computed off-chain via:
///   `zktable-graph commit --node 5 --salt 12345`
/// => 0x1be75cf9bc734dc2f3dda9e274fc5809a73db9cc1d2f677f4f021b3895028836
const REVEAL_NODE: u32 = 5;
const REVEAL_SALT: u32 = 12345;
const REVEAL_COMMITMENT_HEX: &str =
    "1be75cf9bc734dc2f3dda9e274fc5809a73db9cc1d2f677f4f021b3895028836";

fn hex32(env: &Env, s: &str) -> BytesN<32> {
    let s = s.trim_start_matches("0x");
    assert_eq!(s.len(), 64, "expected 32-byte hex string");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).expect("invalid hex");
    }
    BytesN::from_array(env, &out)
}

fn be32(x: u32) -> [u8; 32] {
    let mut a = [0u8; 32];
    a[28..32].copy_from_slice(&x.to_be_bytes());
    a
}

fn phantom_role(env: &Env) -> Symbol {
    Symbol::new(env, "phantom")
}
fn investigator_role(env: &Env) -> Symbol {
    Symbol::new(env, "investigator")
}

/// The `n_rounds`/`reveal_rounds` combo used by the brief for the
/// ZK-binding tests (24 rounds, reveals at [3, 8, 13, 18, 24]).
fn reveal_rounds_24(env: &Env) -> SorobanVec<u32> {
    let mut v = SorobanVec::new(env);
    for r in [3u32, 8, 13, 18, 24] {
        v.push_back(r);
    }
    v
}

fn single_reveal_round(env: &Env, round: u32) -> SorobanVec<u32> {
    let mut v = SorobanVec::new(env);
    v.push_back(round);
    v
}

// ---------- env / registration helpers ----------

fn setup_env() -> Env {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    // These tests exercise game logic, not auth; per-seat require_auth is
    // covered by the dedicated auth tests at the bottom of this file.
    env.mock_all_auths();
    let _ = env.host().set_diagnostic_level(DiagnosticLevel::None);
    env
}

fn register_verifier(env: &Env) -> Address {
    let vk_bytes = Bytes::from_slice(env, VK_BIN);
    env.register(UltraHonkVerifierContract, (vk_bytes,))
}

fn register_referee(
    env: &Env,
    verifier: Address,
    root: BytesN<32>,
    n_rounds: u32,
    reveal_rounds: SorobanVec<u32>,
) -> Address {
    env.register(RefereeContract, (verifier, root, n_rounds, reveal_rounds))
}

/// Joins one phantom + one investigator, sets their start positions, and
/// calls `start`. Returns (phantom_idx, investigator_idx).
fn join_and_start(
    env: &Env,
    referee_id: &Address,
    phantom_commitment: BytesN<32>,
    investigator_node: u32,
    phantom_tickets: (u32, u32, u32),
    investigator_tickets: (u32, u32, u32),
) -> (u32, u32) {
    let phantom_addr = Address::generate(env);
    let investigator_addr = Address::generate(env);

    let phantom_idx = env
        .as_contract(referee_id, || {
            RefereeContract::join(
                env.clone(),
                phantom_addr,
                phantom_role(env),
                phantom_tickets.0,
                phantom_tickets.1,
                phantom_tickets.2,
            )
        })
        .expect("join phantom ok");
    let investigator_idx = env
        .as_contract(referee_id, || {
            RefereeContract::join(
                env.clone(),
                investigator_addr,
                investigator_role(env),
                investigator_tickets.0,
                investigator_tickets.1,
                investigator_tickets.2,
            )
        })
        .expect("join investigator ok");

    env.as_contract(referee_id, || {
        RefereeContract::set_hidden_start(env.clone(), phantom_idx, phantom_commitment.clone())
    })
    .expect("set_hidden_start ok");
    env.as_contract(referee_id, || {
        RefereeContract::set_public_start(env.clone(), investigator_idx, investigator_node)
    })
    .expect("set_public_start ok");
    env.as_contract(referee_id, || RefereeContract::start(env.clone()))
        .expect("start ok");

    (phantom_idx, investigator_idx)
}

fn game_state(env: &Env, referee_id: &Address) -> GameState {
    env.as_contract(referee_id, || RefereeContract::game_state(env.clone()))
}

// ---------- 1. happy path ----------

#[test]
fn happy_path_hidden_move_verifies_and_updates_state() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let root = fixture_root(&env);
    let referee_id = register_referee(&env, verifier_id, root, 24, reveal_rounds_24(&env));

    let c_old = fixture_c_old(&env);
    let c_new = fixture_c_new(&env);
    let (phantom_idx, _investigator_idx) =
        join_and_start(&env, &referee_id, c_old, 10, (1, 1, 1), (1, 1, 1));

    let proof = Bytes::from_slice(&env, PROOF_BIN);
    env.as_contract(&referee_id, || {
        RefereeContract::submit_hidden_move(env.clone(), phantom_idx, c_new.clone(), 0, proof)
    })
    .expect("submit_hidden_move ok");

    let state = game_state(&env, &referee_id);
    let phantom_view = state.players.get(phantom_idx).unwrap();
    assert_eq!(phantom_view.hidden_commitment, Some(c_new));
    assert_eq!(phantom_view.resources, (0, 1, 1)); // taxi (ticket 0) decremented
    let mut expected_feed = SorobanVec::new(&env);
    expected_feed.push_back(0u32);
    assert_eq!(state.ticket_feed, expected_feed);
    assert_eq!(state.turn_index, 1); // advanced to investigator
    assert_eq!(state.round, 1);
    assert_eq!(state.status, Status::Active);
}

// ---------- 2. binding rejection: wrong c_old ----------

#[test]
fn binding_rejects_proof_when_stored_c_old_differs() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let root = fixture_root(&env);
    let referee_id = register_referee(&env, verifier_id, root, 24, reveal_rounds_24(&env));

    let wrong_c_old = BytesN::from_array(&env, &[0x42u8; 32]);
    let c_new = fixture_c_new(&env);
    let (phantom_idx, _investigator_idx) =
        join_and_start(&env, &referee_id, wrong_c_old, 10, (1, 1, 1), (1, 1, 1));

    let proof = Bytes::from_slice(&env, PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_hidden_move(env.clone(), phantom_idx, c_new, 0, proof)
        })
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);
}

// ---------- 3. binding rejection: wrong graph root ----------

#[test]
fn binding_rejects_proof_when_graph_root_differs() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let wrong_root = BytesN::from_array(&env, &[0x99u8; 32]);
    let referee_id = register_referee(&env, verifier_id, wrong_root, 24, reveal_rounds_24(&env));

    let c_old = fixture_c_old(&env);
    let c_new = fixture_c_new(&env);
    let (phantom_idx, _investigator_idx) =
        join_and_start(&env, &referee_id, c_old, 10, (1, 1, 1), (1, 1, 1));

    let proof = Bytes::from_slice(&env, PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_hidden_move(env.clone(), phantom_idx, c_new, 0, proof)
        })
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);
}

// ---------- 4. turn / role enforcement ----------

#[test]
fn moves_rejected_before_start() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let root = BytesN::from_array(&env, &[0u8; 32]);
    let referee_id = register_referee(&env, verifier, root, 24, reveal_rounds_24(&env));

    let phantom_addr = Address::generate(&env);
    let investigator_addr = Address::generate(&env);
    let phantom_idx = env
        .as_contract(&referee_id, || {
            RefereeContract::join(env.clone(), phantom_addr, phantom_role(&env), 1, 1, 1)
        })
        .expect("join phantom ok");
    let investigator_idx = env
        .as_contract(&referee_id, || {
            RefereeContract::join(
                env.clone(),
                investigator_addr,
                investigator_role(&env),
                1,
                1,
                1,
            )
        })
        .expect("join investigator ok");
    // Deliberately do not call start(): status remains Lobby.

    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_hidden_move(
                env.clone(),
                phantom_idx,
                BytesN::from_array(&env, &[0u8; 32]),
                0,
                Bytes::new(&env),
            )
        })
        .expect_err("expected NotActive");
    assert_eq!(err, Error::NotActive);

    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_public_move(env.clone(), investigator_idx, 1, 0)
        })
        .expect_err("expected NotActive");
    assert_eq!(err, Error::NotActive);
}

#[test]
fn wrong_turn_rejected_for_investigator_first_move() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let root = BytesN::from_array(&env, &[0u8; 32]);
    let referee_id = register_referee(&env, verifier, root, 24, reveal_rounds_24(&env));

    let (_phantom_idx, investigator_idx) = join_and_start(
        &env,
        &referee_id,
        BytesN::from_array(&env, &[0x11u8; 32]),
        10,
        (1, 1, 1),
        (1, 1, 1),
    );

    // It is the phantom's turn (turn_index == 0); investigator tries to move.
    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_public_move(env.clone(), investigator_idx, 20, 0)
        })
        .expect_err("expected NotYourTurn");
    assert_eq!(err, Error::NotYourTurn);
}

#[test]
fn wrong_role_rejected_when_investigators_turn() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let root = fixture_root(&env);
    let referee_id = register_referee(&env, verifier_id, root, 24, reveal_rounds_24(&env));

    let c_old = fixture_c_old(&env);
    let c_new = fixture_c_new(&env);
    let (phantom_idx, investigator_idx) =
        join_and_start(&env, &referee_id, c_old, 10, (1, 1, 1), (1, 1, 1));

    let proof = Bytes::from_slice(&env, PROOF_BIN);
    env.as_contract(&referee_id, || {
        RefereeContract::submit_hidden_move(env.clone(), phantom_idx, c_new, 0, proof)
    })
    .expect("phantom move ok, turn now belongs to investigator");

    // It is now the investigator's turn (turn_index == 1); the investigator
    // calling submit_hidden_move passes the turn check but fails the role
    // check (only the phantom may submit hidden moves).
    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_hidden_move(
                env.clone(),
                investigator_idx,
                BytesN::from_array(&env, &[0x77u8; 32]),
                0,
                Bytes::new(&env),
            )
        })
        .expect_err("expected WrongRole");
    assert_eq!(err, Error::WrongRole);
}

#[test]
fn moves_rejected_after_finished() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let root = BytesN::from_array(&env, &[0u8; 32]);
    // n_rounds = 1, reveal at round 1: reveal with no capture ends the game
    // (phantom wins, final round reached).
    let referee_id = register_referee(&env, verifier, root, 1, single_reveal_round(&env, 1));

    let commitment = hex32(&env, REVEAL_COMMITMENT_HEX);
    let (phantom_idx, investigator_idx) =
        join_and_start(&env, &referee_id, commitment, 999, (1, 1, 1), (1, 1, 1));

    let salt_bytes = BytesN::from_array(&env, &be32(REVEAL_SALT));
    env.as_contract(&referee_id, || {
        RefereeContract::reveal(env.clone(), phantom_idx, REVEAL_NODE, salt_bytes)
    })
    .expect("reveal ok, final round, no capture -> phantom wins");

    let state = game_state(&env, &referee_id);
    assert_eq!(state.status, Status::Finished);
    assert_eq!(state.outcome, Some(phantom_role(&env)));

    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_public_move(env.clone(), investigator_idx, 1, 0)
        })
        .expect_err("expected NotActive after Finished");
    assert_eq!(err, Error::NotActive);
}

// ---------- 5. reveal + capture ----------

#[test]
fn reveal_with_matching_investigator_node_ends_game_as_investigator_win() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let root = BytesN::from_array(&env, &[0u8; 32]);
    // n_rounds = 24 so round 1 is NOT the final round; capture must still
    // end the game immediately regardless of round count.
    let referee_id = register_referee(&env, verifier, root, 24, single_reveal_round(&env, 1));

    let commitment = hex32(&env, REVEAL_COMMITMENT_HEX);
    // Investigator starts exactly at the phantom's revealed node -> capture.
    let (phantom_idx, _investigator_idx) = join_and_start(
        &env,
        &referee_id,
        commitment,
        REVEAL_NODE,
        (1, 1, 1),
        (1, 1, 1),
    );

    let salt_bytes = BytesN::from_array(&env, &be32(REVEAL_SALT));
    env.as_contract(&referee_id, || {
        RefereeContract::reveal(env.clone(), phantom_idx, REVEAL_NODE, salt_bytes)
    })
    .expect("reveal ok");

    let state = game_state(&env, &referee_id);
    assert_eq!(state.status, Status::Finished);
    assert_eq!(state.outcome, Some(investigator_role(&env)));
    assert_eq!(state.reveal_log.get(0).unwrap(), (1u32, REVEAL_NODE));
}

#[test]
fn reveal_without_matching_investigator_node_continues_game() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let root = BytesN::from_array(&env, &[0u8; 32]);
    let referee_id = register_referee(&env, verifier, root, 24, single_reveal_round(&env, 1));

    let commitment = hex32(&env, REVEAL_COMMITMENT_HEX);
    // Investigator elsewhere -> no capture, round 1 != n_rounds (24) -> continue.
    let (phantom_idx, _investigator_idx) =
        join_and_start(&env, &referee_id, commitment, 999, (1, 1, 1), (1, 1, 1));

    let salt_bytes = BytesN::from_array(&env, &be32(REVEAL_SALT));
    env.as_contract(&referee_id, || {
        RefereeContract::reveal(env.clone(), phantom_idx, REVEAL_NODE, salt_bytes)
    })
    .expect("reveal ok, no capture");

    let state = game_state(&env, &referee_id);
    assert_eq!(state.status, Status::Active);
    assert_eq!(state.outcome, None);
    assert_eq!(state.reveal_log.get(0).unwrap(), (1u32, REVEAL_NODE));
}

#[test]
fn reveal_with_wrong_salt_rejected() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let root = BytesN::from_array(&env, &[0u8; 32]);
    let referee_id = register_referee(&env, verifier, root, 24, single_reveal_round(&env, 1));

    let commitment = hex32(&env, REVEAL_COMMITMENT_HEX);
    let (phantom_idx, _investigator_idx) =
        join_and_start(&env, &referee_id, commitment, 999, (1, 1, 1), (1, 1, 1));

    let wrong_salt_bytes = BytesN::from_array(&env, &be32(REVEAL_SALT + 1));
    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::reveal(env.clone(), phantom_idx, REVEAL_NODE, wrong_salt_bytes)
        })
        .expect_err("expected RevealMismatch");
    assert_eq!(err, Error::RevealMismatch);
}

// ---------- 6. NoTicket ----------

#[test]
fn no_ticket_rejects_when_exhausted() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let root = fixture_root(&env);
    let referee_id = register_referee(&env, verifier_id, root, 24, reveal_rounds_24(&env));

    let c_old = fixture_c_old(&env);
    let c_new = fixture_c_new(&env);
    // Phantom starts with zero taxi (ticket 0) tickets.
    let (phantom_idx, _investigator_idx) =
        join_and_start(&env, &referee_id, c_old, 10, (0, 1, 1), (1, 1, 1));

    let proof = Bytes::from_slice(&env, PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            RefereeContract::submit_hidden_move(env.clone(), phantom_idx, c_new, 0, proof)
        })
        .expect_err("expected NoTicket");
    assert_eq!(err, Error::NoTicket);
}

// ---------- 7. auth: a signer who doesn't own the seat is rejected ----------

#[test]
fn wrong_signer_cannot_move_a_seat() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let _ = env.host().set_diagnostic_level(DiagnosticLevel::None);
    let verifier_id = register_verifier(&env);
    let root = fixture_root(&env);
    let referee_id = register_referee(&env, verifier_id, root, 24, reveal_rounds_24(&env));
    let client = RefereeContractClient::new(&env, &referee_id);

    let phantom_addr = Address::generate(&env);
    let investigator_addr = Address::generate(&env);
    let attacker = Address::generate(&env);

    // Lobby setup: join is permissionless, but set_*_start needs each seat's
    // auth — mock all auths just to build a valid Active game.
    env.mock_all_auths();
    client.join(&phantom_addr, &phantom_role(&env), &1, &1, &1);
    client.join(&investigator_addr, &investigator_role(&env), &1, &1, &1);
    client.set_hidden_start(&0, &fixture_c_old(&env));
    client.set_public_start(&1, &10);
    client.start();

    // Phantom's turn (seat 0). The attacker signs instead of the phantom:
    // require_auth(phantom_addr) must abort the invocation before any state
    // change or proof verification.
    let proof = Bytes::from_slice(&env, PROOF_BIN);
    env.set_auths(&[]);
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "submit_hidden_move",
            args: (0u32, fixture_c_new(&env), 0u32, proof.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = client.try_submit_hidden_move(&0, &fixture_c_new(&env), &0, &proof);
    assert!(res.is_err(), "attacker-signed hidden move must be rejected");

    // The phantom's own signature still works.
    env.set_auths(&[]);
    env.mock_auths(&[MockAuth {
        address: &phantom_addr,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "submit_hidden_move",
            args: (0u32, fixture_c_new(&env), 0u32, proof.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.submit_hidden_move(&0, &fixture_c_new(&env), &0, &proof);
    let state = game_state(&env, &referee_id);
    assert_eq!(
        state.players.get(0).unwrap().hidden_commitment,
        Some(fixture_c_new(&env))
    );
}
