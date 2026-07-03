#![no_std]
extern crate alloc;

// zkTable Coup-lite referee: the `deck` module's load-bearing showcase --
// "prove-hold-or-bluff". Mirrors `packages/contracts/contracts/
// liars-dice-referee/src/lib.rs`'s structure (`poseidon2_hash2` verbatim,
// cross-contract `verify_proof` against a `zktable-verifier` instance loaded
// with the `card_membership` VK, `be32`, `#[contracterror]`, `#[contracttype]`
// instance-storage state, `Result` returns, no `Option<compound-type>`
// fields under `testutils` -- see that file's module doc for the gotcha).
//
// --- HONEST SIMPLIFICATION (PRD SS7.2, deck v1) -----------------------------
// This is NOT full mental-poker/coSNARK dealing security. The initial hand
// commitments are supplied by a semi-honest dealer/orchestrator during the
// `Deal` phase (the `deal` entrypoint below) -- this referee does not verify
// that the deal came from a valid shuffle over a shared deck (a
// `valid_shuffle` circuit proving a permutation is a bijection over [0,N)
// would be needed for that, and is explicitly out of scope for v1 -- see the
// `card_membership` circuit's module doc and the M6.3 report). What IS real
// and load-bearing: once dealt, a player's actual hand is fixed and hidden
// behind Poseidon2 commitments, and the `card_membership` ZK proof genuinely
// proves (in zero knowledge, without revealing which of the two cards it is,
// or the other card's identity) that a claimed character sits in that
// player's committed hand -- the "hold" half of "prove-hold-or-bluff".
//
// --- Influence / challenge flow --------------------------------------------
// Each player starts with `influence = 2` (Coup: two hidden character
// cards). Turn-ordered `claim(player, character)` is a PUBLIC claim to be
// holding `character` (no on-chain action economy beyond this -- see the
// M6.3 brief, "you don't need Coup's full coin/action economy for v1"). Any
// OTHER alive player may `challenge` the single standing "last claim" at any
// time before it is superseded by a newer claim. The challenged player
// (`target`) must then respond with exactly one of:
//   - `prove_hold(target, claimed, proof)`: a REAL `card_membership` proof
//     that `claimed` (== the claim's character) is genuinely in `target`'s
//     committed hand. `public_inputs = [claimed | c_0 | c_1]` is built from
//     the referee's OWN stored commitments for `target` (never
//     client-supplied) and verified cross-contract -- exactly the
//     liars-dice referee's binding pattern. On success the claim was
//     truthful, so the CHALLENGER is the one who loses influence.
//   - `reveal_card(target, ...)` directly, DECLINING to prove (i.e.
//     conceding the bluff): opens one of `target`'s real cards, which
//     immediately costs `target` an influence. (`prove_hold` failing with
//     `VerificationFailed` does not itself cost an influence -- the target
//     may retry or fall back to `reveal_card`; only an explicit reveal, or a
//     successful `prove_hold` naming the CHALLENGER as loser, ends the
//     exchange.)
// Whichever player is determined to have lost the exchange (challenger,
// after a successful `prove_hold`; or target, via a direct decline) must
// call `reveal_card` to actually give up one of their two real cards
// (checked against ITS stored commitment) -- this decrements `influence` and
// marks that hand slot permanently dead. A player reaching `influence == 0`
// is eliminated (`alive = false`). Once exactly one player remains alive,
// `outcome` is set and the game reaches `Finished`.
//
// --- v1 scope: 2-4 players ---------------------------------------------------
// The brief explicitly allows 2-4 players (unlike the liars-dice referee's
// hard 2-player lock) -- there is no single-round soundness constraint here:
// eliminating one player at a time by influence loss is sound for any
// starting count >= 2, since the game simply continues among the remaining
// alive players until exactly one remains.

use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, crypto::BnScalar, symbol_short, Address,
    Bytes, BytesN, Env, InvokeError, IntoVal, Symbol, Val, Vec,
};
use ultrahonk_soroban_verifier::PROOF_BYTES;

/// Fixed hand size, matching `card_membership`'s `H` (Coup: 2 influence cards).
const CARD_H: u32 = 2;
/// v1 scope: 2-4 players (see module doc).
const MIN_PLAYERS: u32 = 2;
const MAX_PLAYERS: u32 = 4;
/// Starting influence (hidden cards) per player.
const START_INFLUENCE: u32 = 2;

#[contract]
pub struct CoupRefereeContract;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    UnsupportedConfig = 2,
    BadPlayerIndex = 3,
    WrongPhase = 4,
    AlreadyDealt = 5,
    BadArrayLength = 6,
    NotYourTurn = 7,
    NotAlive = 8,
    NoActiveClaim = 9,
    ClaimTargetMismatch = 10,
    CannotChallengeSelf = 11,
    ClaimMismatch = 12,
    VerificationFailed = 13,
    ProofSizeMismatch = 14,
    NotAuthorizedToReveal = 15,
    SlotAlreadyRevealed = 16,
    BadSlotIndex = 17,
    CardRevealMismatch = 18,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Phase {
    Deal,
    Playing,
    AwaitingResponse,
    AwaitingReveal,
    Finished,
}

// NOTE: mirrors the liars-dice referee's `Option<compound-type>` /
// `Option<Vec<T>>` avoidance under the `testutils` feature (see that file's
// module doc for the root cause) -- `commitments`/`dead` use an empty `Vec`
// to mean "not yet dealt" rather than `Option<Vec<T>>`. `Option<u32>` fields
// (below, on `GameState`) are unaffected -- only `Option<compound-type>` is
// the problem.
#[contracttype]
#[derive(Clone)]
pub struct PlayerData {
    pub commitments: Vec<BytesN<32>>, // len 2 once dealt; empty == not yet dealt
    pub dead: Vec<bool>,              // len 2 once dealt; dead[i] == slot i revealed/discarded
    pub influence: u32,
    pub alive: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct PlayerView {
    pub dealt: bool,
    pub commitments: Vec<BytesN<32>>,
    pub dead: Vec<bool>,
    pub influence: u32,
    pub alive: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct GameState {
    pub phase: Phase,
    pub n_players: u32,
    pub players: Vec<PlayerView>,
    pub turn: u32,
    pub last_claim_player: Option<u32>,
    pub last_claim_character: Option<u32>,
    pub challenger: Option<u32>,
    pub target: Option<u32>,
    pub pending_loser: Option<u32>,
    pub outcome: Option<u32>,
}

// ---------- storage keys ----------

fn key_verifier() -> Symbol {
    symbol_short!("verifier")
}
fn key_nplayers() -> Symbol {
    symbol_short!("nplayers")
}
fn key_phase() -> Symbol {
    symbol_short!("phase")
}
fn key_players() -> Symbol {
    symbol_short!("players")
}
fn key_turn() -> Symbol {
    symbol_short!("turn")
}
fn key_claimp() -> Symbol {
    symbol_short!("claimp")
}
fn key_claimc() -> Symbol {
    symbol_short!("claimc")
}
fn key_chlgr() -> Symbol {
    symbol_short!("chlgr")
}
fn key_target() -> Symbol {
    symbol_short!("target")
}
fn key_loser() -> Symbol {
    symbol_short!("loser")
}
fn key_outcome() -> Symbol {
    symbol_short!("outcome")
}

// ---------- field helpers (must byte-match graph-tools / the card_membership circuit) ----------

/// Poseidon2 2-to-1 hash, byte-identical to graph-tools / the Noir circuit /
/// the liars-dice referee's `poseidon2_hash2`.
fn poseidon2_hash2(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let modulus = <BnScalar as Field>::modulus(env);
    let a_bytes = Bytes::from_array(env, &a.to_array());
    let b_bytes = Bytes::from_array(env, &b.to_array());
    let mut inputs = Vec::new(env);
    inputs.push_back(soroban_sdk::U256::from_be_bytes(env, &a_bytes).rem_euclid(&modulus));
    inputs.push_back(soroban_sdk::U256::from_be_bytes(env, &b_bytes).rem_euclid(&modulus));
    let out = poseidon2_hash::<4, BnScalar>(env, &inputs);
    let out_bytes = out.to_be_bytes();
    let mut out_arr = [0u8; 32];
    out_bytes.copy_into_slice(&mut out_arr);
    BytesN::from_array(env, &out_arr)
}

/// 32-byte big-endian encoding of a u32, high bytes zero -- the same field
/// representation `zktable-graph`'s `be32(&BigUint)` produces for a small
/// decimal value passed e.g. as `--claimed 3`.
fn be32(x: u32) -> [u8; 32] {
    let mut a = [0u8; 32];
    a[28..32].copy_from_slice(&x.to_be_bytes());
    a
}

fn verify_proof(
    env: &Env,
    verifier: &Address,
    public_inputs: Bytes,
    proof_bytes: Bytes,
) -> Result<(), Error> {
    if proof_bytes.len() as usize != PROOF_BYTES {
        return Err(Error::ProofSizeMismatch);
    }
    let mut args: Vec<Val> = Vec::new(env);
    args.push_back(public_inputs.into_val(env));
    args.push_back(proof_bytes.into_val(env));
    env.try_invoke_contract::<(), InvokeError>(verifier, &Symbol::new(env, "verify_proof"), args)
        .map_err(|_| Error::VerificationFailed)?
        .map_err(|_| Error::VerificationFailed)
}

// ---------- storage accessors ----------

fn get_phase(env: &Env) -> Phase {
    env.storage().instance().get(&key_phase()).unwrap()
}
fn set_phase(env: &Env, p: Phase) {
    env.storage().instance().set(&key_phase(), &p);
}
fn get_players(env: &Env) -> Vec<PlayerData> {
    env.storage().instance().get(&key_players()).unwrap()
}
fn set_players(env: &Env, players: &Vec<PlayerData>) {
    env.storage().instance().set(&key_players(), players);
}
fn get_turn(env: &Env) -> u32 {
    env.storage().instance().get(&key_turn()).unwrap_or(0)
}

fn check_turn(env: &Env, player: u32) -> Result<(), Error> {
    if get_turn(env) != player {
        return Err(Error::NotYourTurn);
    }
    Ok(())
}

fn first_alive(players: &Vec<PlayerData>) -> u32 {
    for i in 0..players.len() {
        if players.get(i).unwrap().alive {
            return i;
        }
    }
    0
}

/// Advance `turn` to the next alive player after `player` (wrapping).
fn advance_turn(env: &Env, players: &Vec<PlayerData>, player: u32) {
    let n = players.len();
    let mut next = (player + 1) % n;
    let mut guard = 0u32;
    while !players.get(next).unwrap().alive && guard < n {
        next = (next + 1) % n;
        guard += 1;
    }
    env.storage().instance().set(&key_turn(), &next);
}

fn all_dealt(players: &Vec<PlayerData>) -> bool {
    for i in 0..players.len() {
        if players.get(i).unwrap().commitments.is_empty() {
            return false;
        }
    }
    true
}

/// Clears the pending claim/challenge/loser bookkeeping once an exchange
/// resolves (a claim is superseded the moment the next `claim` is made, and
/// a challenge exchange fully resolves the moment `reveal_card` completes).
fn clear_exchange(env: &Env) {
    env.storage().instance().remove(&key_claimp());
    env.storage().instance().remove(&key_claimc());
    env.storage().instance().remove(&key_chlgr());
    env.storage().instance().remove(&key_target());
    env.storage().instance().remove(&key_loser());
}

fn get_opt_u32(env: &Env, key: &Symbol) -> Option<u32> {
    env.storage().instance().get(key)
}

#[contractimpl]
impl CoupRefereeContract {
    /// Set config once at deploy. `n_players` must be in [2, 4] (see module
    /// doc -- unlike the liars-dice referee's hard 2-player lock, elimination
    /// by influence loss is sound for any starting count >= 2).
    pub fn __constructor(env: Env, verifier: Address, n_players: u32) -> Result<(), Error> {
        if env.storage().instance().has(&key_verifier()) {
            return Err(Error::AlreadyInitialized);
        }
        if n_players < MIN_PLAYERS || n_players > MAX_PLAYERS {
            return Err(Error::UnsupportedConfig);
        }
        env.storage().instance().set(&key_verifier(), &verifier);
        env.storage().instance().set(&key_nplayers(), &n_players);
        set_phase(&env, Phase::Deal);

        let mut players: Vec<PlayerData> = Vec::new(&env);
        for _ in 0..n_players {
            players.push_back(PlayerData {
                commitments: Vec::new(&env),
                dead: Vec::new(&env),
                influence: START_INFLUENCE,
                alive: true,
            });
        }
        set_players(&env, &players);
        env.storage().instance().set(&key_turn(), &0u32);
        Ok(())
    }

    /// Deal phase: the (semi-honest, per the module doc) dealer/orchestrator
    /// supplies `player`'s 2 hand-card commitments. Once every player has
    /// been dealt, advances to `Playing` with `turn` at the first alive
    /// player.
    pub fn deal(env: Env, player: u32, commitments: Vec<BytesN<32>>) -> Result<(), Error> {
        if get_phase(&env) != Phase::Deal {
            return Err(Error::WrongPhase);
        }
        if commitments.len() != CARD_H {
            return Err(Error::BadArrayLength);
        }
        let mut players = get_players(&env);
        let mut p = players.get(player).ok_or(Error::BadPlayerIndex)?;
        if !p.commitments.is_empty() {
            return Err(Error::AlreadyDealt);
        }
        p.commitments = commitments;
        let mut dead: Vec<bool> = Vec::new(&env);
        for _ in 0..CARD_H {
            dead.push_back(false);
        }
        p.dead = dead;
        players.set(player, p);

        if all_dealt(&players) {
            set_phase(&env, Phase::Playing);
            let first = first_alive(&players);
            env.storage().instance().set(&key_turn(), &first);
        }
        set_players(&env, &players);
        Ok(())
    }

    /// The current-turn player publicly claims to be holding `character`.
    /// Becomes the single "last claim", challengeable by any other alive
    /// player until superseded by the next `claim`. Always succeeds if it is
    /// this player's turn and they are alive; advances `turn` immediately
    /// (claiming does not, by itself, block continued play -- see module doc).
    pub fn claim(env: Env, player: u32, character: u32) -> Result<(), Error> {
        if get_phase(&env) != Phase::Playing {
            return Err(Error::WrongPhase);
        }
        check_turn(&env, player)?;
        let players = get_players(&env);
        let p = players.get(player).ok_or(Error::BadPlayerIndex)?;
        if !p.alive {
            return Err(Error::NotAlive);
        }
        env.storage().instance().set(&key_claimp(), &player);
        env.storage().instance().set(&key_claimc(), &character);
        advance_turn(&env, &players, player);
        Ok(())
    }

    /// Any OTHER alive player challenges the current standing "last claim"
    /// (must target the claim's own player). Opens the response window.
    pub fn challenge(env: Env, challenger: u32, target: u32) -> Result<(), Error> {
        if get_phase(&env) != Phase::Playing {
            return Err(Error::WrongPhase);
        }
        let claim_player: u32 = env
            .storage()
            .instance()
            .get(&key_claimp())
            .ok_or(Error::NoActiveClaim)?;
        if claim_player != target {
            return Err(Error::ClaimTargetMismatch);
        }
        if challenger == target {
            return Err(Error::CannotChallengeSelf);
        }
        let players = get_players(&env);
        let ch = players.get(challenger).ok_or(Error::BadPlayerIndex)?;
        if !ch.alive {
            return Err(Error::NotAlive);
        }
        let tg = players.get(target).ok_or(Error::BadPlayerIndex)?;
        if !tg.alive {
            return Err(Error::NotAlive);
        }
        env.storage().instance().set(&key_chlgr(), &challenger);
        env.storage().instance().set(&key_target(), &target);
        set_phase(&env, Phase::AwaitingResponse);
        Ok(())
    }

    /// `target` proves in ZK that `claimed` (must equal the challenged
    /// claim's character) is genuinely in their committed hand. Builds
    /// `public_inputs = [claimed | c_0 | c_1]` from the referee's OWN stored
    /// commitments for `target` (never client-supplied) and verifies
    /// cross-contract against the `card_membership` VK. On success the claim
    /// was truthful: the CHALLENGER is the designated loser and must call
    /// `reveal_card` to complete the influence loss. A failed verification
    /// does NOT itself cost an influence -- the target may retry or fall
    /// back to `reveal_card` (decline).
    pub fn prove_hold(env: Env, target: u32, claimed: u32, proof: Bytes) -> Result<(), Error> {
        if get_phase(&env) != Phase::AwaitingResponse {
            return Err(Error::WrongPhase);
        }
        let stored_target: u32 = env.storage().instance().get(&key_target()).ok_or(Error::WrongPhase)?;
        if stored_target != target {
            return Err(Error::BadPlayerIndex);
        }
        let claim_character: u32 = env.storage().instance().get(&key_claimc()).unwrap();
        if claimed != claim_character {
            return Err(Error::ClaimMismatch);
        }
        let players = get_players(&env);
        let p = players.get(target).ok_or(Error::BadPlayerIndex)?;

        let mut public_inputs = Bytes::new(&env);
        public_inputs.append(&Bytes::from_array(&env, &be32(claimed)));
        for i in 0..p.commitments.len() {
            public_inputs.append(&Bytes::from_array(&env, &p.commitments.get(i).unwrap().to_array()));
        }

        let verifier: Address = env.storage().instance().get(&key_verifier()).unwrap();
        verify_proof(&env, &verifier, public_inputs, proof)?;

        let challenger: u32 = env.storage().instance().get(&key_chlgr()).unwrap();
        env.storage().instance().set(&key_loser(), &challenger);
        set_phase(&env, Phase::AwaitingReveal);
        Ok(())
    }

    /// Reveal one of `player`'s two real cards, checked against its stored
    /// commitment, and lose an influence. Valid in exactly two contexts (see
    /// module doc): (a) `player` is the challenged `target`, directly
    /// declining to `prove_hold` (a bluff concession); or (b) `player` is the
    /// designated `pending_loser` after a successful `prove_hold` completing
    /// the mandated loss. Either way this fully resolves the challenge
    /// exchange: clears claim/challenge bookkeeping, advances `turn` past the
    /// CHALLENGER (whose turn the challenge itself consumed -- mirrors
    /// `claim`'s own `advance_turn` call, so exactly one `advance_turn`
    /// happens per resolved player action, claim or challenge alike), and if
    /// exactly one player remains alive, sets `outcome` and finishes the game.
    pub fn reveal_card(env: Env, player: u32, slot: u32, card: u32, salt: BytesN<32>) -> Result<(), Error> {
        let phase = get_phase(&env);
        let is_decline = phase == Phase::AwaitingResponse
            && get_opt_u32(&env, &key_target()) == Some(player);
        let is_mandated = phase == Phase::AwaitingReveal
            && get_opt_u32(&env, &key_loser()) == Some(player);
        if !is_decline && !is_mandated {
            return Err(Error::NotAuthorizedToReveal);
        }
        if slot >= CARD_H {
            return Err(Error::BadSlotIndex);
        }
        let mut players = get_players(&env);
        let mut p = players.get(player).ok_or(Error::BadPlayerIndex)?;
        if p.dead.get(slot).unwrap_or(true) {
            return Err(Error::SlotAlreadyRevealed);
        }
        let card_bytes = BytesN::from_array(&env, &be32(card));
        let computed = poseidon2_hash2(&env, &card_bytes, &salt);
        let stored = p.commitments.get(slot).ok_or(Error::BadSlotIndex)?;
        if computed != stored {
            return Err(Error::CardRevealMismatch);
        }
        p.dead.set(slot, true);
        p.influence -= 1;
        if p.influence == 0 {
            p.alive = false;
        }
        players.set(player, p);
        set_players(&env, &players);

        let challenger: u32 = env.storage().instance().get(&key_chlgr()).unwrap();
        clear_exchange(&env);

        let players = get_players(&env);
        let mut alive_count = 0u32;
        let mut last_alive: u32 = 0;
        for i in 0..players.len() {
            if players.get(i).unwrap().alive {
                alive_count += 1;
                last_alive = i;
            }
        }
        if alive_count <= 1 {
            env.storage().instance().set(&key_outcome(), &last_alive);
            set_phase(&env, Phase::Finished);
        } else {
            set_phase(&env, Phase::Playing);
            advance_turn(&env, &players, challenger);
        }
        Ok(())
    }

    /// Returns everything a client needs to render/drive the game.
    pub fn game_state(env: Env) -> GameState {
        let players = get_players(&env);
        let mut views: Vec<PlayerView> = Vec::new(&env);
        for i in 0..players.len() {
            let p = players.get(i).unwrap();
            views.push_back(PlayerView {
                dealt: !p.commitments.is_empty(),
                commitments: p.commitments.clone(),
                dead: p.dead.clone(),
                influence: p.influence,
                alive: p.alive,
            });
        }
        GameState {
            phase: get_phase(&env),
            n_players: env.storage().instance().get(&key_nplayers()).unwrap(),
            players: views,
            turn: get_turn(&env),
            last_claim_player: get_opt_u32(&env, &key_claimp()),
            last_claim_character: get_opt_u32(&env, &key_claimc()),
            challenger: get_opt_u32(&env, &key_chlgr()),
            target: get_opt_u32(&env, &key_target()),
            pending_loser: get_opt_u32(&env, &key_loser()),
            outcome: env.storage().instance().get(&key_outcome()),
        }
    }
}
