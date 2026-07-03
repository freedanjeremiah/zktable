//! Native (Soroban test host) tests for the Coup-lite referee.
//!
//! These register a real `zktable-verifier` instance loaded with the
//! `card_membership` circuit's VK and drive a REAL `card_membership` proof
//! through a cross-contract call, proving the referee's ZK binding:
//! `public_inputs` are built from the referee's OWN stored commitments for
//! the challenged player and the caller-supplied `claimed` character, never
//! client-supplied wholesale.
//!
//! Fixture (`tests/fixtures/card_membership_p0_*`) was generated off-chain via
//! the `zktable-graph` tool + real `nargo`/`bb`, from:
//!   player 0's REAL hand: cards [1, 3], salts [11, 22]
//!     -> zktable-graph deal --cards 1,3 --salts 11,22
//!     -> c_0 = 0x2fce237cfc855e1470da2ee9d838df88e87702910afa2834da68bdb25af4962f
//!        c_1 = 0x138a8dd6091b712fbaa28ae5e9b18e3d64864854daf75fc6ca87c9b381622b9a
//!   proof: claimed_card = 3, held_index = 1 (card[1] == 3, a TRUE claim)
//!     -> zktable-graph card-witness --claimed 3 --cards 1,3 --salts 11,22
//!        --held 1 --prover Prover.toml --json card_witness.json
//!     -> nargo execute -> bb prove --scheme ultra_honk --oracle_hash keccak
//! Independently `bb verify`'d against `card_membership_vk` before being
//! committed as a fixture (see the M6.3 report for the exact commands).
//!
//! Two other players' hands are dealt WITHOUT a proof fixture (only their
//! commitments are needed): player 1: cards [0, 2], salts [301, 302];
//! player 2 (3-player tests only): cards [4, 0], salts [401, 402].

use soroban_env_host::DiagnosticLevel;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal, Vec as SorobanVec,
};
use zktable_coup_referee::{CoupRefereeContract, CoupRefereeContractClient, Error, GameState, Phase};
use zktable_verifier::UltraHonkVerifierContract;

const VK_BIN: &[u8] = include_bytes!("fixtures/card_membership_vk");
const P0_PROOF_BIN: &[u8] = include_bytes!("fixtures/card_membership_p0_proof");

// player 0's REAL hand (the one the fixture proof is bound to).
const P0_CARDS: [u32; 2] = [1, 3];
const P0_SALTS: [u32; 2] = [11, 22];
// player 1's REAL hand.
const P1_CARDS: [u32; 2] = [0, 2];
const P1_SALTS: [u32; 2] = [301, 302];
// player 2's REAL hand (3-player tests only) -- deliberately DIFFERENT
// commitments than player 0's, used to test the proof-binding rejection when
// a valid proof is presented against the wrong player's stored commitments.
const P2_CARDS: [u32; 2] = [4, 0];
const P2_SALTS: [u32; 2] = [401, 402];

// The fixture proof's baked-in claimed character (see module doc).
const FIXTURE_CLAIMED: u32 = 3;

// ---------- fixture / field helpers ----------

fn be32(env: &Env, x: u32) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[28..32].copy_from_slice(&x.to_be_bytes());
    BytesN::from_array(env, &a)
}

/// Poseidon2 2-to-1 hash matching `zktable-graph`/the circuit/the referee's
/// own `poseidon2_hash2` -- used here purely to derive expected commitments
/// for the test hands, independent of the contract under test.
fn hash2(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    use soroban_poseidon::{poseidon2_hash, Field};
    use soroban_sdk::crypto::BnScalar;
    let modulus = <BnScalar as Field>::modulus(env);
    let a_bytes = Bytes::from_array(env, &a.to_array());
    let b_bytes = Bytes::from_array(env, &b.to_array());
    let mut inputs = SorobanVec::new(env);
    inputs.push_back(soroban_sdk::U256::from_be_bytes(env, &a_bytes).rem_euclid(&modulus));
    inputs.push_back(soroban_sdk::U256::from_be_bytes(env, &b_bytes).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, BnScalar>(env, &inputs);
    let mut out_arr = [0u8; 32];
    out.to_be_bytes().copy_into_slice(&mut out_arr);
    BytesN::from_array(env, &out_arr)
}

fn hand_commitments(env: &Env, cards: [u32; 2], salts: [u32; 2]) -> SorobanVec<BytesN<32>> {
    let mut v = SorobanVec::new(env);
    for i in 0..2 {
        v.push_back(hash2(env, &be32(env, cards[i]), &be32(env, salts[i])));
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

fn seat_addresses(env: &Env, n_players: u32) -> SorobanVec<Address> {
    let mut v = SorobanVec::new(env);
    for _ in 0..n_players {
        v.push_back(Address::generate(env));
    }
    v
}

fn register_referee(env: &Env, verifier: Address, n_players: u32) -> Address {
    env.register(CoupRefereeContract, (verifier, seat_addresses(env, n_players)))
}

fn game_state(env: &Env, referee_id: &Address) -> GameState {
    env.as_contract(referee_id, || CoupRefereeContract::game_state(env.clone()))
}

fn deal(env: &Env, referee_id: &Address, player: u32, cards: [u32; 2], salts: [u32; 2]) {
    let commitments = hand_commitments(env, cards, salts);
    env.as_contract(referee_id, || CoupRefereeContract::deal(env.clone(), player, commitments))
        .expect("deal ok");
}

// ---------- 1. happy path: claim -> challenge -> prove_hold (Ok) -> reveal
//              -> claim -> challenge -> decline -> reveal -> Finished -------

#[test]
fn happy_path_full_game_resolves_to_a_definitive_winner() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 2);

    assert_eq!(game_state(&env, &referee_id).phase, Phase::Deal);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Playing);
    assert_eq!(state.turn, 0);
    assert!(state.players.get(0).unwrap().dealt);
    assert!(state.players.get(1).unwrap().dealt);

    // --- round A: player 0 truthfully claims character 3 (matches the fixture
    //     proof); player 1 challenges; player 0 proves it in ZK -> player 1
    //     (the CHALLENGER) is the designated loser. ---------------------------
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, FIXTURE_CLAIMED))
        .expect("claim(0, 3) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.turn, 1);
    assert_eq!(state.last_claim_player, Some(0));
    assert_eq!(state.last_claim_character, Some(FIXTURE_CLAIMED));

    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::AwaitingResponse);
    assert_eq!(state.challenger, Some(1));
    assert_eq!(state.target, Some(0));

    let proof0 = Bytes::from_slice(&env, P0_PROOF_BIN);
    env.as_contract(&referee_id, || {
        CoupRefereeContract::prove_hold(env.clone(), 0, FIXTURE_CLAIMED, proof0)
    })
    .expect("prove_hold(0, 3, proof0) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::AwaitingReveal);
    assert_eq!(state.pending_loser, Some(1));

    // Player 1 (the loser) reveals their real slot-0 card to complete the loss.
    // `reveal_card` also advances `turn` past the CHALLENGER (player 1) --
    // mirrors `claim`'s own `advance_turn` call, so a resolved challenge
    // consumes a turn exactly like a claim does (turn: 1 -> 0).
    env.as_contract(&referee_id, || {
        CoupRefereeContract::reveal_card(env.clone(), 1, 0, P1_CARDS[0], be32(&env, P1_SALTS[0]))
    })
    .expect("reveal_card(1, 0, ..) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Playing);
    assert_eq!(state.turn, 0);
    assert_eq!(state.players.get(1).unwrap().influence, 1);
    assert!(state.players.get(1).unwrap().alive);
    assert_eq!(state.players.get(1).unwrap().dead.get(0), Some(true));
    // Claim/challenge bookkeeping is cleared once the exchange resolves.
    assert_eq!(state.last_claim_player, None);
    assert_eq!(state.challenger, None);
    assert_eq!(state.pending_loser, None);

    // --- round B: player 0 (whose turn it now is) claims TRUE again (the
    //     fixture proof is reusable -- proof verification is stateless, no
    //     replay protection, matching the referee's documented scope); player
    //     1 challenges again; player 0 proves it again -> player 1 (the
    //     CHALLENGER, again) loses their second (and last) influence ->
    //     eliminated -> Finished. -------------------------------------------
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, FIXTURE_CLAIMED))
        .expect("claim(0, 3) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.turn, 1);

    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");

    let proof0_again = Bytes::from_slice(&env, P0_PROOF_BIN);
    env.as_contract(&referee_id, || {
        CoupRefereeContract::prove_hold(env.clone(), 0, FIXTURE_CLAIMED, proof0_again)
    })
    .expect("prove_hold(0, 3, proof0) ok (2nd round)");

    // Player 1 reveals their remaining real card (slot 1: card 2, salt 302).
    env.as_contract(&referee_id, || {
        CoupRefereeContract::reveal_card(env.clone(), 1, 1, P1_CARDS[1], be32(&env, P1_SALTS[1]))
    })
    .expect("reveal_card(1, 1, ..) ok");

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Finished);
    assert_eq!(state.outcome, Some(0));
    assert_eq!(state.players.get(1).unwrap().influence, 0);
    assert!(!state.players.get(1).unwrap().alive);
    assert!(state.players.get(0).unwrap().alive);
    assert_eq!(state.players.get(1).unwrap().dead, SorobanVec::from_array(&env, [true, true]));
}

// ---------- 2. bluff path: target declines a FALSE claim directly ----------

#[test]
fn bluff_path_target_declines_and_loses_influence() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 2);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);

    // Player 0's real hand is [1, 3] -- claiming character 4 is a bluff (they
    // hold no such card, so no `card_membership` witness exists for it).
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 4))
        .expect("claim(0, 4) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");

    // Player 0 declines (concedes the bluff) by revealing a real card instead
    // of attempting `prove_hold`.
    env.as_contract(&referee_id, || {
        CoupRefereeContract::reveal_card(env.clone(), 0, 0, P0_CARDS[0], be32(&env, P0_SALTS[0]))
    })
    .expect("reveal_card(0, 0, ..) ok");

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Playing);
    assert_eq!(state.players.get(0).unwrap().influence, 1);
    assert!(state.players.get(0).unwrap().alive);
    assert_eq!(state.players.get(0).unwrap().dead.get(0), Some(true));
    assert_eq!(state.outcome, None);
}

// ---------- 3. proof-binding rejection: proof for a DIFFERENT claimed character ----------

#[test]
fn binding_rejects_proof_for_a_different_claimed_character() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 2);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);

    // Player 0 claims character 1 (also true, but a DIFFERENT character than
    // the fixture proof's baked claimed_card = 3).
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 1))
        .expect("claim(0, 1) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");

    // Attempt to reuse the fixture proof (claimed_card = 3 baked in) for
    // claimed = 1: passes the referee's own claim-match sanity check
    // (claimed == last_claim_character == 1... wait: must supply claimed=1 to
    // pass that check), but the constructed public_inputs (claimed=1) will
    // NOT match what the proof was actually generated against (claimed=3) ->
    // cross-contract verification must fail.
    let proof0 = Bytes::from_slice(&env, P0_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::prove_hold(env.clone(), 0, 1, proof0))
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);

    // Unresolved: still awaiting a response from player 0.
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::AwaitingResponse);
}

// ---------- 4. proof-binding rejection: proof bound to DIFFERENT commitments ----------

#[test]
fn binding_rejects_proof_bound_to_a_different_players_commitments() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 3);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);
    deal(&env, &referee_id, 2, P2_CARDS, P2_SALTS);

    // Advance turn to player 2 with two throwaway claims.
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 0))
        .expect("claim(0, 0) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 1, 0))
        .expect("claim(1, 0) ok");

    // Player 2 claims character 3 (matching the fixture proof's claimed_card,
    // to pass the referee's claim-match sanity check) -- but player 2's REAL
    // dealt commitments are entirely different from player 0's (the hand the
    // fixture proof is actually bound to).
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 2, FIXTURE_CLAIMED))
        .expect("claim(2, 3) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 0, 2))
        .expect("challenge(0, 2) ok");

    let proof0 = Bytes::from_slice(&env, P0_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::prove_hold(env.clone(), 2, FIXTURE_CLAIMED, proof0)
        })
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);
}

// ---------- 5. reveal_card rejects a mismatched card/salt ----------

#[test]
fn reveal_card_rejects_a_mismatched_card() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 2);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);

    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 4))
        .expect("claim(0, 4) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");

    // Wrong card value for slot 0 (real card is 1, not 2); salt unchanged.
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::reveal_card(env.clone(), 0, 0, 2, be32(&env, P0_SALTS[0]))
        })
        .expect_err("expected CardRevealMismatch");
    assert_eq!(err, Error::CardRevealMismatch);

    // State unchanged: still awaiting player 0's response.
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::AwaitingResponse);
    assert_eq!(state.players.get(0).unwrap().influence, 2);
}

// ---------- 6. turn / phase / target guards ----------

#[test]
fn claim_rejected_out_of_turn() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 2);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);

    // It is player 0's turn; player 1 tries to claim.
    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 1, 0))
        .expect_err("expected NotYourTurn");
    assert_eq!(err, Error::NotYourTurn);
}

#[test]
fn claim_rejected_before_deal_completes() {
    let env = setup_env();
    let verifier = Address::generate(&env);
    let referee_id = register_referee(&env, verifier, 2);

    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 0))
        .expect_err("expected WrongPhase");
    assert_eq!(err, Error::WrongPhase);
}

#[test]
fn challenge_without_an_active_claim_rejected() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 2);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);

    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect_err("expected NoActiveClaim");
    assert_eq!(err, Error::NoActiveClaim);
}

#[test]
fn challenge_self_rejected() {
    let env = setup_env();
    let verifier_id = register_verifier(&env);
    let referee_id = register_referee(&env, verifier_id, 2);
    deal(&env, &referee_id, 0, P0_CARDS, P0_SALTS);
    deal(&env, &referee_id, 1, P1_CARDS, P1_SALTS);

    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 1))
        .expect("claim(0, 1) ok");
    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 0, 0))
        .expect_err("expected CannotChallengeSelf");
    assert_eq!(err, Error::CannotChallengeSelf);
}

// ---------- 7. constructor config validation ----------

#[test]
fn constructor_rejects_unsupported_player_count() {
    let result = std::panic::catch_unwind(|| {
        // Deliberately NOT `setup_env()` (which disables diagnostics): the
        // contract error text this assertion checks for is only emitted in
        // the panic message when diagnostics are on (mirrors the liars-dice
        // referee's / `zktable-verifier`'s constructor negative tests).
        let env = Env::default();
        env.cost_estimate().budget().reset_unlimited();
        let verifier = Address::generate(&env);
        // A single seat address — the referee requires 2..=4.
        let mut one_seat = SorobanVec::new(&env);
        one_seat.push_back(Address::generate(&env));
        let _ = env.register(CoupRefereeContract, (verifier, one_seat));
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
    let referee_id = env.register(CoupRefereeContract, (verifier_id, seats));
    let client = CoupRefereeContractClient::new(&env, &referee_id);

    // Deal both hands with each seat's own auth so the game reaches Playing.
    env.mock_all_auths();
    client.deal(&0, &hand_commitments(&env, P0_CARDS, P0_SALTS));
    client.deal(&1, &hand_commitments(&env, P1_CARDS, P1_SALTS));

    // Seat 0's turn. The attacker signs seat 0's claim: require_auth(seat0)
    // must abort the invocation.
    env.set_auths(&[]);
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "claim",
            args: (0u32, 0u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = client.try_claim(&0, &0);
    assert!(res.is_err(), "attacker-signed claim must be rejected");

    // Seat 0's own signature works.
    env.set_auths(&[]);
    env.mock_auths(&[MockAuth {
        address: &seat0,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "claim",
            args: (0u32, 0u32).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.claim(&0, &0);
    let state = game_state(&env, &referee_id);
    assert_eq!(state.last_claim_player, Some(0));
}
