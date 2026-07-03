//! Native (Soroban test host) tests for the Liar's Dice referee.
//!
//! These register a real `zktable-verifier` instance loaded with the
//! `dice_valid` circuit's VK and drive real `dice_valid` proofs through a
//! cross-contract call, proving the referee's ZK binding: `public_inputs`
//! are built from the referee's OWN stored `seed` and the caller's player
//! index, never client-supplied.
//!
//! Fixtures (`tests/fixtures/dice_valid_*`) were generated off-chain via the
//! `zktable-graph` tool + real `nargo`/`bb`, from:
//!   nonce_0 = 777001, nonce_1 = 888002
//!   seed    = zktable-graph seed --nonces 777001,888002
//!           = 0x2dabe9b6972bc1f021a8a6e14586631d4ea9a4802712a94c07626ff70325f309
//!   player 0: salts 11001..11005 -> dice [5, 6, 5, 4, 6]
//!   player 1: salts 22001..22005 -> dice [5, 4, 3, 5, 1]
//! (see the M6.2 report for the exact commands). Both proofs independently
//! verify via `bb verify` against `dice_valid_vk`.

use soroban_env_host::DiagnosticLevel;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal, Vec as SorobanVec,
};
use zktable_liars_dice_referee::{Bid, Error, GameState, LiarsDiceRefereeContract, Phase};
use zktable_verifier::UltraHonkVerifierContract;

const VK_BIN: &[u8] = include_bytes!("fixtures/dice_valid_vk");
const P0_PROOF_BIN: &[u8] = include_bytes!("fixtures/dice_valid_p0_proof");
const P0_PUB_BIN: &[u8] = include_bytes!("fixtures/dice_valid_p0_public_inputs");
const P1_PROOF_BIN: &[u8] = include_bytes!("fixtures/dice_valid_p1_proof");
const P1_PUB_BIN: &[u8] = include_bytes!("fixtures/dice_valid_p1_public_inputs");

// nonce_commitment = zktable-graph commit --value <nonce> --salt 0
const NONCE0: u32 = 777001;
const NONCE0_COMMITMENT_HEX: &str = "0459295bd71676f50cc2bdcc074d92e94624ba5a83f96967a851e1a5b9be768e";
const NONCE1: u32 = 888002;
const NONCE1_COMMITMENT_HEX: &str = "049b2464895047c5e8cd74f7cdd3ee6d40c172e550ec1c2c195ddde543339dec";

// A second, unrelated nonce pair (folds to a DIFFERENT seed than the one the
// fixture proofs were generated against) used for the wrong-seed binding test.
const OTHER_NONCE0: u32 = 1;
const OTHER_NONCE0_COMMITMENT_HEX: &str = "1e05013a2f40c60dc58cfe36bfa4d7e94676c43436922368628342bc5144d103";
const OTHER_NONCE1: u32 = 2;
const OTHER_NONCE1_COMMITMENT_HEX: &str = "24f8c162c4a75a200f3d486f5910b1ab8fe297ce1cce94e55e2af0da0a421507";

const P0_DICE: [u32; 5] = [5, 6, 5, 4, 6];
const P0_SALTS: [u32; 5] = [11001, 11002, 11003, 11004, 11005];
const P1_DICE: [u32; 5] = [5, 4, 3, 5, 1];
const P1_SALTS: [u32; 5] = [22001, 22002, 22003, 22004, 22005];

// ---------- fixture helpers ----------

fn slice32(bin: &[u8], env: &Env, offset: usize) -> BytesN<32> {
    let mut a = [0u8; 32];
    a.copy_from_slice(&bin[offset..offset + 32]);
    BytesN::from_array(env, &a)
}

fn p0_seed(env: &Env) -> BytesN<32> {
    slice32(P0_PUB_BIN, env, 0)
}
fn p1_seed(env: &Env) -> BytesN<32> {
    slice32(P1_PUB_BIN, env, 0)
}
fn p0_commitments(env: &Env) -> SorobanVec<BytesN<32>> {
    let mut v = SorobanVec::new(env);
    for i in 0..5 {
        v.push_back(slice32(P0_PUB_BIN, env, 64 + i * 32));
    }
    v
}
fn p1_commitments(env: &Env) -> SorobanVec<BytesN<32>> {
    let mut v = SorobanVec::new(env);
    for i in 0..5 {
        v.push_back(slice32(P1_PUB_BIN, env, 64 + i * 32));
    }
    v
}

fn hex32(env: &Env, s: &str) -> BytesN<32> {
    let s = s.trim_start_matches("0x");
    assert_eq!(s.len(), 64, "expected 32-byte hex string");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).expect("invalid hex");
    }
    BytesN::from_array(env, &out)
}

fn be32(env: &Env, x: u32) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[28..32].copy_from_slice(&x.to_be_bytes());
    BytesN::from_array(env, &a)
}

fn u32_vec(env: &Env, xs: &[u32]) -> SorobanVec<u32> {
    let mut v = SorobanVec::new(env);
    for x in xs {
        v.push_back(*x);
    }
    v
}

fn salts_vec(env: &Env, xs: &[u32]) -> SorobanVec<BytesN<32>> {
    let mut v = SorobanVec::new(env);
    for x in xs {
        v.push_back(be32(env, *x));
    }
    v
}

// ---------- env / registration helpers ----------

fn setup_env() -> Env {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    // These tests exercise game logic, not auth; per-seat require_auth is
    // covered by the dedicated auth test at the bottom of this file.
    env.mock_all_auths();
    let _ = env.host().set_diagnostic_level(DiagnosticLevel::None);
    env
}

fn register_verifier(env: &Env) -> Address {
    let vk_bytes = Bytes::from_slice(env, VK_BIN);
    env.register(UltraHonkVerifierContract, (vk_bytes,))
}

fn seat_addresses(env: &Env) -> SorobanVec<Address> {
    let mut v = SorobanVec::new(env);
    v.push_back(Address::generate(env));
    v.push_back(Address::generate(env));
    v
}

fn register_referee(env: &Env, verifier: Address) -> Address {
    env.register(
        LiarsDiceRefereeContract,
        (verifier, seat_addresses(env), 5u32, 6u32),
    )
}

fn game_state(env: &Env, referee_id: &Address) -> GameState {
    env.as_contract(referee_id, || LiarsDiceRefereeContract::game_state(env.clone()))
}

/// Drives commit_nonce/reveal_nonce for both players with the REAL fixture
/// nonces (777001, 888002), landing on the exact seed the fixture proofs
/// were generated against. Returns once phase == Roll.
fn commit_reveal_real_nonces(env: &Env, referee_id: &Address) {
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::commit_nonce(env.clone(), 0, hex32(env, NONCE0_COMMITMENT_HEX))
    })
    .expect("commit_nonce(0) ok");
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::commit_nonce(env.clone(), 1, hex32(env, NONCE1_COMMITMENT_HEX))
    })
    .expect("commit_nonce(1) ok");

    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::reveal_nonce(env.clone(), 0, be32(env, NONCE0))
    })
    .expect("reveal_nonce(0) ok");
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::reveal_nonce(env.clone(), 1, be32(env, NONCE1))
    })
    .expect("reveal_nonce(1) ok");
}

/// Same as above but with a DIFFERENT nonce pair (1, 2) — folds to a seed
/// that does NOT match the one baked into the fixture proofs.
fn commit_reveal_other_nonces(env: &Env, referee_id: &Address) {
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::commit_nonce(env.clone(), 0, hex32(env, OTHER_NONCE0_COMMITMENT_HEX))
    })
    .expect("commit_nonce(0) ok");
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::commit_nonce(env.clone(), 1, hex32(env, OTHER_NONCE1_COMMITMENT_HEX))
    })
    .expect("commit_nonce(1) ok");

    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::reveal_nonce(env.clone(), 0, be32(env, OTHER_NONCE0))
    })
    .expect("reveal_nonce(0) ok");
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::reveal_nonce(env.clone(), 1, be32(env, OTHER_NONCE1))
    })
    .expect("reveal_nonce(1) ok");
}

fn submit_both_dice_ok(env: &Env, referee_id: &Address) {
    let proof0 = Bytes::from_slice(env, P0_PROOF_BIN);
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::submit_dice(env.clone(), 0, p0_commitments(env), proof0)
    })
    .expect("submit_dice(0) ok");

    let proof1 = Bytes::from_slice(env, P1_PROOF_BIN);
    env.as_contract(referee_id, || {
        LiarsDiceRefereeContract::submit_dice(env.clone(), 1, p1_commitments(env), proof1)
    })
    .expect("submit_dice(1) ok");
}

// ---------- 1. happy path: commit -> reveal -> seed -> roll -> bid -> challenge -> reveal -> resolve ----------

#[test]
fn happy_path_full_game_resolves_to_a_definitive_winner() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id);

    assert_eq!(game_state(&env, &referee_id).phase, Phase::CommitNonce);

    commit_reveal_real_nonces(&env, &referee_id);
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Roll);
    assert_eq!(state.seed, Some(p0_seed(&env)));
    assert_eq!(p0_seed(&env), p1_seed(&env)); // both fixture proofs share the same seed

    submit_both_dice_ok(&env, &referee_id);
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Bid);
    assert_eq!(state.turn, 0);
    assert!(state.players.get(0).unwrap().rolled);
    assert!(state.players.get(1).unwrap().rolled);

    // Player 0 bids "at least 3 fives". True count across both hands: p0 has
    // two 5s ([5,6,5,4,6]), p1 has two 5s ([5,4,3,5,1]) -> 4 total >= 3.
    env.as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 0, 3, 5))
        .expect("bid(0, 3, 5) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.turn, 1);
    let mut expected_curbid = SorobanVec::new(&env);
    expected_curbid.push_back(Bid { player: 0, quantity: 3, face: 5 });
    assert_eq!(state.current_bid, expected_curbid);

    // Player 1 challenges instead of raising.
    env.as_contract(&referee_id, || LiarsDiceRefereeContract::challenge(env.clone(), 1))
        .expect("challenge(1) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Reveal);
    assert_eq!(state.challenger, Some(1));

    env.as_contract(&referee_id, || {
        LiarsDiceRefereeContract::reveal_dice(env.clone(), 0, u32_vec(&env, &P0_DICE), salts_vec(&env, &P0_SALTS))
    })
    .expect("reveal_dice(0) ok");
    // Not fully resolved yet — only one of two players has revealed.
    assert_eq!(game_state(&env, &referee_id).phase, Phase::Reveal);

    env.as_contract(&referee_id, || {
        LiarsDiceRefereeContract::reveal_dice(env.clone(), 1, u32_vec(&env, &P1_DICE), salts_vec(&env, &P1_SALTS))
    })
    .expect("reveal_dice(1) ok");

    // True count of face 5 == 4 >= bid quantity 3 -> the CHALLENGER (player 1) loses.
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Finished);
    assert_eq!(state.outcome, Some(0));
    assert!(state.players.get(0).unwrap().alive);
    assert!(!state.players.get(1).unwrap().alive);
    assert_eq!(state.players.get(0).unwrap().revealed_dice, u32_vec(&env, &P0_DICE));
    assert_eq!(state.players.get(1).unwrap().revealed_dice, u32_vec(&env, &P1_DICE));
}

// ---------- 2. proof-binding rejection: wrong seed ----------

#[test]
fn binding_rejects_proof_when_referee_seed_differs_from_fixture_seed() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id);

    // Commit/reveal a DIFFERENT nonce pair than the one the fixture proofs
    // were generated against -> the referee's own computed `seed` will not
    // match the proof's baked-in public `seed` input.
    commit_reveal_other_nonces(&env, &referee_id);
    assert_eq!(game_state(&env, &referee_id).phase, Phase::Roll);
    assert_ne!(game_state(&env, &referee_id).seed, Some(p0_seed(&env)));

    let proof0 = Bytes::from_slice(&env, P0_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            LiarsDiceRefereeContract::submit_dice(env.clone(), 0, p0_commitments(&env), proof0)
        })
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);
}

// ---------- 3. proof-binding rejection: wrong player_id ----------

#[test]
fn binding_rejects_proof_when_submitted_under_the_wrong_player_index() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id);

    commit_reveal_real_nonces(&env, &referee_id);

    // Player 0's real proof/commitments are bound to player_id = 0. Submit
    // them under player index 1 instead: the referee builds public_inputs
    // with be32(1), which does not match the proof's baked player_id = 0.
    let proof0 = Bytes::from_slice(&env, P0_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            LiarsDiceRefereeContract::submit_dice(env.clone(), 1, p0_commitments(&env), proof0)
        })
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);
}

// ---------- 4. dice reveal mismatch rejected ----------

#[test]
fn dice_reveal_mismatch_rejected() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id);

    commit_reveal_real_nonces(&env, &referee_id);
    submit_both_dice_ok(&env, &referee_id);

    env.as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 0, 3, 5))
        .expect("bid ok");
    env.as_contract(&referee_id, || LiarsDiceRefereeContract::challenge(env.clone(), 1))
        .expect("challenge ok");

    // Tamper with one die value (5 -> 6); salts are unchanged, so the
    // recomputed commitment for that die will not match the stored one.
    let mut tampered = P0_DICE;
    tampered[0] = 6;
    let err = env
        .as_contract(&referee_id, || {
            LiarsDiceRefereeContract::reveal_dice(env.clone(), 0, u32_vec(&env, &tampered), salts_vec(&env, &P0_SALTS))
        })
        .expect_err("expected DiceRevealMismatch");
    assert_eq!(err, Error::DiceRevealMismatch);
}

// ---------- 5. out-of-phase / out-of-turn rejected ----------

#[test]
fn bid_rejected_before_roll_phase_completes() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let referee_id = register_referee(&env, verifier);

    // Still in CommitNonce phase.
    let err = env
        .as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 0, 1, 1))
        .expect_err("expected WrongPhase");
    assert_eq!(err, Error::WrongPhase);
}

#[test]
fn bid_rejected_out_of_turn() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id);

    commit_reveal_real_nonces(&env, &referee_id);
    submit_both_dice_ok(&env, &referee_id);

    // It is player 0's turn (turn == 0); player 1 tries to bid.
    let err = env
        .as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 1, 1, 1))
        .expect_err("expected NotYourTurn");
    assert_eq!(err, Error::NotYourTurn);
}

#[test]
fn challenge_with_no_current_bid_rejected() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id);

    commit_reveal_real_nonces(&env, &referee_id);
    submit_both_dice_ok(&env, &referee_id);

    let err = env
        .as_contract(&referee_id, || LiarsDiceRefereeContract::challenge(env.clone(), 0))
        .expect_err("expected NoCurrentBid");
    assert_eq!(err, Error::NoCurrentBid);
}

// ---------- 6. bid escalation ----------

#[test]
fn bid_that_does_not_escalate_rejected() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id);

    commit_reveal_real_nonces(&env, &referee_id);
    submit_both_dice_ok(&env, &referee_id);

    env.as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 0, 3, 5))
        .expect("first bid ok");

    // Same quantity, same face — does not escalate.
    let err = env
        .as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 1, 3, 5))
        .expect_err("expected BidDoesNotEscalate");
    assert_eq!(err, Error::BidDoesNotEscalate);

    // Lower quantity — does not escalate either.
    let err = env
        .as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 1, 2, 6))
        .expect_err("expected BidDoesNotEscalate");
    assert_eq!(err, Error::BidDoesNotEscalate);

    // Same quantity, higher face — DOES escalate.
    env.as_contract(&referee_id, || LiarsDiceRefereeContract::bid(env.clone(), 1, 3, 6))
        .expect("escalating bid ok");
}

// ---------- 7. constructor config validation ----------

#[test]
fn constructor_rejects_unsupported_player_count() {
    let result = std::panic::catch_unwind(|| {
        // Deliberately NOT `setup_env()` (which disables diagnostics): the
        // contract error text this assertion checks for is only emitted in
        // the panic message when diagnostics are on (mirrors
        // `zktable-verifier`'s constructor negative tests).
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();
        let verifier = Address::generate(&env);
        // Three seat addresses — the v1 referee only supports exactly 2.
        let mut three_seats = SorobanVec::new(&env);
        for _ in 0..3 {
            three_seats.push_back(Address::generate(&env));
        }
        let _ = env.register(LiarsDiceRefereeContract, (verifier, three_seats, 5u32, 6u32));
    });
    let panic = result.expect_err("expected constructor to panic");
    let msg = panic.downcast_ref::<String>().map(|s| s.as_str()).unwrap_or("");
    assert!(
        msg.contains("Error(Contract, #2)"),
        "constructor should fail with UnsupportedConfig (#2), got: {msg}"
    );
}

// ---------- 8. auth: a signer who doesn't own the seat is rejected ----------

#[test]
fn wrong_signer_cannot_act_for_a_seat() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let _ = env.host().set_diagnostic_level(DiagnosticLevel::None);
    let verifier_id = register_verifier(&env);

    let seat0 = Address::generate(&env);
    let seat1 = Address::generate(&env);
    let attacker = Address::generate(&env);
    let mut seats = SorobanVec::new(&env);
    seats.push_back(seat0.clone());
    seats.push_back(seat1.clone());
    let referee_id = env.register(LiarsDiceRefereeContract, (verifier_id, seats, 5u32, 6u32));
    let client =
        zktable_liars_dice_referee::LiarsDiceRefereeContractClient::new(&env, &referee_id);

    // The attacker signs seat 0's nonce commitment: require_auth(seat0) must
    // abort the invocation.
    let commitment = hex32(&env, NONCE0_COMMITMENT_HEX);
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "commit_nonce",
            args: (0u32, commitment.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = client.try_commit_nonce(&0, &commitment);
    assert!(res.is_err(), "attacker-signed commit_nonce must be rejected");

    // Seat 0's own signature works.
    env.set_auths(&[]);
    env.mock_auths(&[MockAuth {
        address: &seat0,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "commit_nonce",
            args: (0u32, commitment.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.commit_nonce(&0, &commitment);
    let state = game_state(&env, &referee_id);
    assert!(state.players.get(0).unwrap().committed);
}
