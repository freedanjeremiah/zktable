//! Native (Soroban test host) tests for the Coup-lite referee (M8.3: provably
//! fair deal via `valid_shuffle`).
//!
//! These register two real `zktable-verifier` instances — one loaded with the
//! `card_membership` VK, one with the `valid_shuffle` VK — and drive REAL
//! proofs through cross-contract calls, proving both binding invariants:
//! `submit_shuffle`'s public_inputs are rebuilt from the referee's OWN stored
//! commit-reveal seed, and `prove_hold`'s from its OWN stored hand
//! commitments (never client-supplied wholesale).
//!
//! Fixtures (`tests/fixtures/*`) were generated off-chain via the
//! `zktable-graph` tool + real `nargo`/`bb` (see the M8.3 notes):
//!   nonce_0 = 777001, nonce_1 = 888002   (same pair as the liars-dice tests)
//!   seed    = zktable-graph seed --nonces 777001,888002
//!           = 0x2dabe9b6972bc1f021a8a6e14586631d4ea9a4802712a94c07626ff70325f309
//!   deck    = zktable-graph shuffle-witness --seed <seed>
//!             --salts 11,22,301,302,401,402,901,...,909
//!     -> cards by position: [0,4,3,1,4,2,1,2,2,1,4,3,3,0,0]
//!     -> player 0's hand = positions 0,1 = cards [0,4], salts [11,22]
//!     -> player 1's hand = positions 2,3 = cards [3,1], salts [301,302]
//!   card proof: claimed_card = 4, held_index = 1 (card[1] == 4, TRUE claim)
//!     bound to player 0's hand above; independently `bb verify`'d.
//!   valid_shuffle_otherseed_proof: an honest shuffle proof for the seed
//!     folded from nonces (1, 2) — used to prove wrong-seed rejection.

use soroban_env_host::DiagnosticLevel;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Bytes, BytesN, Env, IntoVal, Vec as SorobanVec,
};
use zktable_coup_referee::{CoupRefereeContract, CoupRefereeContractClient, Error, GameState, Phase};
use zktable_verifier::UltraHonkVerifierContract;

const CARD_VK_BIN: &[u8] = include_bytes!("fixtures/card_membership_vk");
const P0_PROOF_BIN: &[u8] = include_bytes!("fixtures/card_membership_p0_proof");
const SHUFFLE_VK_BIN: &[u8] = include_bytes!("fixtures/valid_shuffle_vk");
const SHUFFLE_PROOF_BIN: &[u8] = include_bytes!("fixtures/valid_shuffle_proof");
const SHUFFLE_OTHERSEED_PROOF_BIN: &[u8] = include_bytes!("fixtures/valid_shuffle_otherseed_proof");

// Seed commit-reveal nonces (same pair the liars-dice fixtures use).
const NONCE0: u32 = 777001;
const NONCE0_COMMITMENT_HEX: &str = "0459295bd71676f50cc2bdcc074d92e94624ba5a83f96967a851e1a5b9be768e";
const NONCE1: u32 = 888002;
const NONCE1_COMMITMENT_HEX: &str = "049b2464895047c5e8cd74f7cdd3ee6d40c172e550ec1c2c195ddde543339dec";

// The seed-forced deck for the fixture seed: cards by position + the dealer's
// salts (both public knowledge inside these tests; on-chain only the leaves
// are public until reveals happen).
const DECK_CARDS: [u32; 15] = [0, 4, 3, 1, 4, 2, 1, 2, 2, 1, 4, 3, 3, 0, 0];
const DECK_SALTS: [u32; 15] = [11, 22, 301, 302, 401, 402, 901, 902, 903, 904, 905, 906, 907, 908, 909];

// Position-assigned hands (player p == positions 2p, 2p+1).
const P0_CARDS: [u32; 2] = [DECK_CARDS[0], DECK_CARDS[1]]; // [0, 4]
const P0_SALTS: [u32; 2] = [DECK_SALTS[0], DECK_SALTS[1]];
const P1_CARDS: [u32; 2] = [DECK_CARDS[2], DECK_CARDS[3]]; // [3, 1]
const P1_SALTS: [u32; 2] = [DECK_SALTS[2], DECK_SALTS[3]];

// The fixture card proof's baked-in claimed character (player 0 truly holds it).
const FIXTURE_CLAIMED: u32 = 4;
// A character player 0 does NOT hold (their hand is [0, 4]) — a bluff.
const P0_BLUFF: u32 = 2;

// ---------- fixture / field helpers ----------

fn be32(env: &Env, x: u32) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[28..32].copy_from_slice(&x.to_be_bytes());
    BytesN::from_array(env, &a)
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

/// Poseidon2 2-to-1 hash matching `zktable-graph`/the circuits/the referee's
/// own `poseidon2_hash2` — used here purely to derive the expected deck
/// leaves, independent of the contract under test.
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

/// The 15 committed deck leaves for the fixture shuffle.
fn deck_leaves(env: &Env) -> SorobanVec<BytesN<32>> {
    let mut v = SorobanVec::new(env);
    for i in 0..15 {
        v.push_back(hash2(env, &be32(env, DECK_CARDS[i]), &be32(env, DECK_SALTS[i])));
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

fn register_card_verifier(env: &Env) -> Address {
    let vk_bytes = Bytes::from_slice(env, CARD_VK_BIN);
    env.register(UltraHonkVerifierContract, (vk_bytes,))
}

fn register_shuffle_verifier(env: &Env) -> Address {
    let vk_bytes = Bytes::from_slice(env, SHUFFLE_VK_BIN);
    env.register(UltraHonkVerifierContract, (vk_bytes,))
}

fn seat_addresses(env: &Env, n_players: u32) -> SorobanVec<Address> {
    let mut v = SorobanVec::new(env);
    for _ in 0..n_players {
        v.push_back(Address::generate(env));
    }
    v
}

fn register_referee(env: &Env, card_vrf: Address, shuffle_vrf: Address, n_players: u32) -> Address {
    env.register(
        CoupRefereeContract,
        (card_vrf, shuffle_vrf, seat_addresses(env, n_players)),
    )
}

fn game_state(env: &Env, referee_id: &Address) -> GameState {
    env.as_contract(referee_id, || CoupRefereeContract::game_state(env.clone()))
}

/// Drives seed commit/reveal with the REAL fixture nonces, landing on the
/// exact seed the shuffle fixture proof was generated against. Leaves the
/// referee in `Phase::Shuffle`.
fn commit_reveal_fixture_nonces(env: &Env, referee_id: &Address) {
    env.as_contract(referee_id, || {
        CoupRefereeContract::commit_seed_nonce(env.clone(), 0, hex32(env, NONCE0_COMMITMENT_HEX))
    })
    .expect("commit_seed_nonce(0) ok");
    env.as_contract(referee_id, || {
        CoupRefereeContract::commit_seed_nonce(env.clone(), 1, hex32(env, NONCE1_COMMITMENT_HEX))
    })
    .expect("commit_seed_nonce(1) ok");
    env.as_contract(referee_id, || {
        CoupRefereeContract::reveal_seed_nonce(env.clone(), 0, be32(env, NONCE0))
    })
    .expect("reveal_seed_nonce(0) ok");
    env.as_contract(referee_id, || {
        CoupRefereeContract::reveal_seed_nonce(env.clone(), 1, be32(env, NONCE1))
    })
    .expect("reveal_seed_nonce(1) ok");
}

/// Full pre-game: seed commit/reveal + the REAL shuffle proof. Returns a
/// referee in `Phase::Playing` with position-assigned hands.
fn setup_shuffled_game(env: &Env) -> Address {
    let card_vrf = register_card_verifier(env);
    let shuffle_vrf = register_shuffle_verifier(env);
    let referee_id = register_referee(env, card_vrf, shuffle_vrf, 2);
    commit_reveal_fixture_nonces(env, &referee_id);
    let proof = Bytes::from_slice(env, SHUFFLE_PROOF_BIN);
    env.as_contract(&referee_id, || {
        CoupRefereeContract::submit_shuffle(env.clone(), deck_leaves(env), proof)
    })
    .expect("submit_shuffle ok");
    referee_id
}

// ---------- 1. the shuffle flow itself ----------

#[test]
fn shuffle_flow_assigns_position_hands_and_starts_play() {
    let env = setup_env();
    let card_vrf = register_card_verifier(&env);
    let shuffle_vrf = register_shuffle_verifier(&env);
    let referee_id = register_referee(&env, card_vrf, shuffle_vrf, 2);

    assert_eq!(game_state(&env, &referee_id).phase, Phase::SeedCommit);
    commit_reveal_fixture_nonces(&env, &referee_id);

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Shuffle);
    assert_eq!(
        state.seed,
        Some(hex32(&env, "2dabe9b6972bc1f021a8a6e14586631d4ea9a4802712a94c07626ff70325f309"))
    );

    let proof = Bytes::from_slice(&env, SHUFFLE_PROOF_BIN);
    env.as_contract(&referee_id, || {
        CoupRefereeContract::submit_shuffle(env.clone(), deck_leaves(&env), proof)
    })
    .expect("submit_shuffle ok");

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Playing);
    assert_eq!(state.turn, 0);
    assert_eq!(state.deck.len(), 15);
    // Position-assigned hands: player p holds leaves 2p, 2p+1 — no dealer choice.
    let leaves = deck_leaves(&env);
    assert_eq!(
        state.players.get(0).unwrap().commitments,
        SorobanVec::from_array(&env, [leaves.get(0).unwrap(), leaves.get(1).unwrap()])
    );
    assert_eq!(
        state.players.get(1).unwrap().commitments,
        SorobanVec::from_array(&env, [leaves.get(2).unwrap(), leaves.get(3).unwrap()])
    );
}

#[test]
fn shuffle_rejects_a_tampered_proof() {
    let env = setup_env();
    let card_vrf = register_card_verifier(&env);
    let shuffle_vrf = register_shuffle_verifier(&env);
    let referee_id = register_referee(&env, card_vrf, shuffle_vrf, 2);
    commit_reveal_fixture_nonces(&env, &referee_id);

    let mut tampered = SHUFFLE_PROOF_BIN.to_vec();
    tampered[100] ^= 0x01;
    let proof = Bytes::from_slice(&env, &tampered);
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::submit_shuffle(env.clone(), deck_leaves(&env), proof)
        })
        .expect_err("expected VerificationFailed");
    assert_eq!(err, Error::VerificationFailed);
    assert_eq!(game_state(&env, &referee_id).phase, Phase::Shuffle);
}

#[test]
fn shuffle_rejects_a_proof_for_a_different_seed() {
    // An HONEST shuffle proof — but generated against the seed folded from
    // nonces (1, 2), not this referee's stored commit-reveal seed. The
    // referee rebuilds public_inputs from ITS seed, so verification fails:
    // a dealer cannot smuggle in an order derived from a seed of their choice.
    let env = setup_env();
    let card_vrf = register_card_verifier(&env);
    let shuffle_vrf = register_shuffle_verifier(&env);
    let referee_id = register_referee(&env, card_vrf, shuffle_vrf, 2);
    commit_reveal_fixture_nonces(&env, &referee_id);

    let proof = Bytes::from_slice(&env, SHUFFLE_OTHERSEED_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::submit_shuffle(env.clone(), deck_leaves(&env), proof)
        })
        .expect_err("expected VerificationFailed");
    assert_eq!(err, Error::VerificationFailed);
}

#[test]
fn shuffle_rejects_a_wrong_leaf_count() {
    let env = setup_env();
    let card_vrf = register_card_verifier(&env);
    let shuffle_vrf = register_shuffle_verifier(&env);
    let referee_id = register_referee(&env, card_vrf, shuffle_vrf, 2);
    commit_reveal_fixture_nonces(&env, &referee_id);

    let mut short = deck_leaves(&env);
    short.pop_back();
    let proof = Bytes::from_slice(&env, SHUFFLE_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::submit_shuffle(env.clone(), short, proof)
        })
        .expect_err("expected BadArrayLength");
    assert_eq!(err, Error::BadArrayLength);
}

#[test]
fn seed_reveal_rejects_a_mismatched_nonce() {
    let env = setup_env();
    let card_vrf = register_card_verifier(&env);
    let shuffle_vrf = register_shuffle_verifier(&env);
    let referee_id = register_referee(&env, card_vrf, shuffle_vrf, 2);

    env.as_contract(&referee_id, || {
        CoupRefereeContract::commit_seed_nonce(env.clone(), 0, hex32(&env, NONCE0_COMMITMENT_HEX))
    })
    .expect("commit ok");
    // Revealing before everyone has committed is a phase error (prevents
    // last-mover seed bias).
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::reveal_seed_nonce(env.clone(), 0, be32(&env, NONCE0))
        })
        .expect_err("expected WrongPhase");
    assert_eq!(err, Error::WrongPhase);

    env.as_contract(&referee_id, || {
        CoupRefereeContract::commit_seed_nonce(env.clone(), 1, hex32(&env, NONCE1_COMMITMENT_HEX))
    })
    .expect("commit ok");
    // A nonce that doesn't open the commitment is rejected.
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::reveal_seed_nonce(env.clone(), 0, be32(&env, NONCE0 + 1))
        })
        .expect_err("expected NonceRevealMismatch");
    assert_eq!(err, Error::NonceRevealMismatch);
}

// ---------- 2. happy path: claim -> challenge -> prove_hold (Ok) -> reveal
//              -> claim -> challenge -> prove -> reveal -> Finished ----------

#[test]
fn happy_path_full_game_resolves_to_a_definitive_winner() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::Playing);
    assert_eq!(state.turn, 0);
    assert!(state.players.get(0).unwrap().dealt);
    assert!(state.players.get(1).unwrap().dealt);

    // --- round A: player 0 truthfully claims character 4 (their shuffled
    //     hand is [0, 4] — matches the fixture proof); player 1 challenges;
    //     player 0 proves it in ZK -> player 1 (the CHALLENGER) loses. -------
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, FIXTURE_CLAIMED))
        .expect("claim(0, 4) ok");
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
    .expect("prove_hold(0, 4, proof0) ok");
    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::AwaitingReveal);
    assert_eq!(state.pending_loser, Some(1));

    // Player 1 (the loser) reveals their real slot-0 card to complete the
    // loss. `reveal_card` also advances `turn` past the CHALLENGER (player
    // 1), so a resolved challenge consumes a turn exactly like a claim does.
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
    assert_eq!(state.last_claim_player, None);
    assert_eq!(state.challenger, None);
    assert_eq!(state.pending_loser, None);

    // --- round B: same true claim + challenge again (the fixture proof is
    //     reusable — proof verification is stateless, no replay protection,
    //     matching the referee's documented scope) -> player 1 loses their
    //     second influence -> eliminated -> Finished. -----------------------
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, FIXTURE_CLAIMED))
        .expect("claim(0, 4) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");
    let proof0_again = Bytes::from_slice(&env, P0_PROOF_BIN);
    env.as_contract(&referee_id, || {
        CoupRefereeContract::prove_hold(env.clone(), 0, FIXTURE_CLAIMED, proof0_again)
    })
    .expect("prove_hold ok (2nd round)");
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

// ---------- 3. bluff path: target declines a FALSE claim directly ----------

#[test]
fn bluff_path_target_declines_and_loses_influence() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

    // Player 0's real (shuffled) hand is [0, 4] — claiming character 2 is a
    // bluff (no `card_membership` witness exists for it).
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, P0_BLUFF))
        .expect("claim(0, 2) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");

    // Player 0 declines (concedes the bluff) by revealing a real card.
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

// ---------- 4. proof-binding rejections ----------

#[test]
fn binding_rejects_proof_for_a_different_claimed_character() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

    // Player 0 claims character 0 (also truly held, but a DIFFERENT character
    // than the fixture proof's baked claimed_card = 4).
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 0))
        .expect("claim(0, 0) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");

    let proof0 = Bytes::from_slice(&env, P0_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::prove_hold(env.clone(), 0, 0, proof0))
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::AwaitingResponse);
}

#[test]
fn binding_rejects_proof_bound_to_a_different_players_commitments() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

    // Advance to player 1's turn with a throwaway claim by player 0.
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 0))
        .expect("claim(0, 0) ok");

    // Player 1 claims character 4 (bluff — their shuffled hand is [3, 1]) and
    // is challenged. They present PLAYER 0's real fixture proof (claimed = 4
    // passes the claim-match check) — but the referee builds public_inputs
    // from PLAYER 1's own stored commitments, so verification fails.
    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 1, FIXTURE_CLAIMED))
        .expect("claim(1, 4) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 0, 1))
        .expect("challenge(0, 1) ok");

    let proof0 = Bytes::from_slice(&env, P0_PROOF_BIN);
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::prove_hold(env.clone(), 1, FIXTURE_CLAIMED, proof0)
        })
        .expect_err("expected verification failure");
    assert_eq!(err, Error::VerificationFailed);
}

// ---------- 5. reveal_card rejects a mismatched card/salt ----------

#[test]
fn reveal_card_rejects_a_mismatched_card() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

    env.as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, P0_BLUFF))
        .expect("claim(0, 2) ok");
    env.as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect("challenge(1, 0) ok");

    // Wrong card value for slot 0 (real card is 0, not 2); salt unchanged.
    let err = env
        .as_contract(&referee_id, || {
            CoupRefereeContract::reveal_card(env.clone(), 0, 0, 2, be32(&env, P0_SALTS[0]))
        })
        .expect_err("expected CardRevealMismatch");
    assert_eq!(err, Error::CardRevealMismatch);

    let state = game_state(&env, &referee_id);
    assert_eq!(state.phase, Phase::AwaitingResponse);
    assert_eq!(state.players.get(0).unwrap().influence, 2);
}

// ---------- 6. turn / phase / target guards ----------

#[test]
fn claim_rejected_out_of_turn() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 1, 0))
        .expect_err("expected NotYourTurn");
    assert_eq!(err, Error::NotYourTurn);
}

#[test]
fn claim_rejected_before_shuffle_completes() {
    let env = setup_env();
    let card_vrf = register_card_verifier(&env);
    let shuffle_vrf = register_shuffle_verifier(&env);
    let referee_id = register_referee(&env, card_vrf, shuffle_vrf, 2);

    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::claim(env.clone(), 0, 0))
        .expect_err("expected WrongPhase");
    assert_eq!(err, Error::WrongPhase);
}

#[test]
fn challenge_without_an_active_claim_rejected() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

    let err = env
        .as_contract(&referee_id, || CoupRefereeContract::challenge(env.clone(), 1, 0))
        .expect_err("expected NoActiveClaim");
    assert_eq!(err, Error::NoActiveClaim);
}

#[test]
fn challenge_self_rejected() {
    let env = setup_env();
    let referee_id = setup_shuffled_game(&env);

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
        let shuffle_verifier = Address::generate(&env);
        // A single seat address — the referee requires 2..=4.
        let mut one_seat = SorobanVec::new(&env);
        one_seat.push_back(Address::generate(&env));
        let _ = env.register(CoupRefereeContract, (verifier, shuffle_verifier, one_seat));
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
    let card_vrf = register_card_verifier(&env);
    let shuffle_vrf = register_shuffle_verifier(&env);

    let seat0 = Address::generate(&env);
    let seat1 = Address::generate(&env);
    let attacker = Address::generate(&env);
    let mut seats = SorobanVec::new(&env);
    seats.push_back(seat0.clone());
    seats.push_back(seat1.clone());
    let referee_id = env.register(CoupRefereeContract, (card_vrf, shuffle_vrf, seats));
    let client = CoupRefereeContractClient::new(&env, &referee_id);

    // The attacker signs seat 0's seed commitment: require_auth(seat0) must
    // abort the invocation.
    let commitment = hex32(&env, NONCE0_COMMITMENT_HEX);
    env.mock_auths(&[MockAuth {
        address: &attacker,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "commit_seed_nonce",
            args: (0u32, commitment.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = client.try_commit_seed_nonce(&0, &commitment);
    assert!(res.is_err(), "attacker-signed commit_seed_nonce must be rejected");

    // Seat 0's own signature works.
    env.set_auths(&[]);
    env.mock_auths(&[MockAuth {
        address: &seat0,
        invoke: &MockAuthInvoke {
            contract: &referee_id,
            fn_name: "commit_seed_nonce",
            args: (0u32, commitment.clone()).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.commit_seed_nonce(&0, &commitment);
    let state = game_state(&env, &referee_id);
    assert!(state.players.get(0).unwrap().seed_committed);
}
