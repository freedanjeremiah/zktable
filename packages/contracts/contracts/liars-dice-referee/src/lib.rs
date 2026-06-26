#![no_std]
extern crate alloc;

// zkTable Liar's Dice referee.
//
// Mirrors `packages/contracts/contracts/referee/src/lib.rs` (the Blackout
// board referee)'s structure: `poseidon2_hash2` (verbatim), the
// cross-contract `verify_proof` call against a `zktable-verifier` instance
// loaded with the `dice_valid` VK, `be32`, `#[contracterror]`,
// `#[contracttype]` instance-storage state, `Result` returns.
//
// --- Fair seed: sealed commit-reveal over per-player nonces -----------------
// Prevents last-mover bias: every player commits `hash2(nonce, 0)` BEFORE any
// nonce is revealed (phase `CommitNonce`); only once every player has
// committed does the contract accept reveals (phase `RevealNonce`); once
// every nonce is revealed the joint seed is computed via the SAME left-fold
// the off-chain tool (`zktable-graph seed --nonces ...`) and the `dice_valid`
// circuit's derivation assume: `seed = hash2(hash2(hash2(0, n_0), n_1), ...)`
// in player-index order. This is stored once and used to build every
// player's `public_inputs` from then on — never client-supplied.
//
// --- Roll: `dice_valid` proof per player ------------------------------------
// `submit_dice` builds `public_inputs = seed | be32(player) | c_0..c_4` (the
// circuit's exact `[seed, player_id, c_0, c_1, c_2, c_3, c_4]` order, 7 * 32
// bytes) from the referee's OWN stored `seed` and the caller's player index —
// never a client-supplied seed/player_id — and verifies it cross-contract.
// Fairness (each `c_j` opens to the canonical seed-derived die) is proven
// IN-CIRCUIT (see `packages/circuits/dice_valid` + M6.1 report); the referee
// only checks (a) the proof against its own seed/player_id and (b), at
// reveal, that `hash2(be32(d_j), salt_j) == c_j`.
//
// --- Bidding, challenge, resolve --------------------------------------------
// Turn-ordered escalating bids (`bid`); the player whose turn it is may
// instead `challenge` the last bid. A challenge opens a reveal phase: every
// player opens `(dice, salts)`, the referee checks each against its stored
// commitments, and once all are open resolves by counting exact-face matches
// across all players' dice (v1: no wild ones, documented) against the
// challenged bid's `(quantity, face)`.
//
// --- v1 scope: n_players == 2 -----------------------------------------------
// The brief explicitly permits "simplest sound v1: single-round, the loser is
// ELIMINATED; if that leaves one player, [...] Finished. (Multi-round
// dice-loss is optional.)" A single elimination round only yields a *sound,
// complete* game when it starts from exactly 2 players (elimination always
// leaves exactly 1 alive player, i.e. a definitive winner, with no need to
// re-roll for a following round). The constructor therefore requires
// `n_players == 2` (and `dice_per_player == 5`, `sides == 6`, matching the
// fixed `dice_valid` circuit's `N`/`SIDES`) and rejects anything else with
// `Error::UnsupportedConfig` — multi-round tournaments (`n_players > 2`) are
// intentionally out of scope for this milestone, flagged here rather than
// left as a latent unsound state.

use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, crypto::BnScalar, symbol_short, Address,
    Bytes, BytesN, Env, InvokeError, IntoVal, Symbol, Val, Vec,
};
use ultrahonk_soroban_verifier::PROOF_BYTES;

/// Fixed roll size, matching `dice_valid`'s `N`.
const DICE_N: u32 = 5;
/// Fixed die sides, matching `dice_valid`'s `SIDES` (baked into its
/// canonicality range-check constants; changing this requires a new circuit).
const SIDES: u32 = 6;
/// The only sound single-round player count for this v1 referee (see module doc).
const N_PLAYERS: u32 = 2;

#[contract]
pub struct LiarsDiceRefereeContract;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    UnsupportedConfig = 2,
    BadPlayerIndex = 3,
    WrongPhase = 4,
    AlreadyCommitted = 5,
    NonceRevealMismatch = 6,
    AlreadyNonceRevealed = 7,
    AlreadyRolled = 8,
    VerificationFailed = 9,
    ProofSizeMismatch = 10,
    BadArrayLength = 11,
    NotYourTurn = 12,
    InvalidFace = 13,
    BidDoesNotEscalate = 14,
    NoCurrentBid = 15,
    DiceRevealMismatch = 16,
    AlreadyDiceRevealed = 17,
    NotAlive = 18,
    NotFullyCommitted = 19,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Phase {
    CommitNonce,
    RevealNonce,
    Roll,
    Bid,
    Reveal,
    Finished,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Bid {
    pub player: u32,
    pub quantity: u32,
    pub face: u32,
}

// NOTE: fields below deliberately avoid `Option<CustomStruct>` /
// `Option<Vec<T>>` (empty `Vec` stands in for "unset" instead — unambiguous,
// since every set value is always exactly `DICE_N`/0-or-1 elements long).
// Under the `testutils` feature (pulled in workspace-wide by this crate's own
// dev-dependencies), the `#[contracttype]` derive's `ScVal` round-trip needs
// an infallible `Into<ScVal>` for a field's type; built-in primitives
// (`BytesN<32>`, `u32`, `Symbol`) have one, but `Option<T>` over a
// `#[contracttype]`-derived struct or a `Vec<T>` does not (those only get a
// fallible `TryInto`), which fails to compile. `Option<primitive>` (e.g.
// `seed`, `challenger`, `outcome` below) is unaffected and matches the board
// referee's proven `Option<BytesN<32>>`/`Option<u32>` usage.
#[contracttype]
#[derive(Clone)]
pub struct PlayerData {
    pub nonce_commitment: Option<BytesN<32>>,
    pub nonce: Option<BytesN<32>>,
    pub dice_commitments: Vec<BytesN<32>>, // empty == not yet rolled
    pub revealed_dice: Vec<u32>,           // empty == not yet revealed
    pub alive: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct PlayerView {
    pub committed: bool,
    pub nonce_revealed: bool,
    pub rolled: bool,
    pub dice_commitments: Vec<BytesN<32>>, // empty == not yet rolled
    pub revealed_dice: Vec<u32>,           // empty == not yet revealed
    pub alive: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct GameState {
    pub phase: Phase,
    pub n_players: u32,
    pub dice_per_player: u32,
    pub sides: u32,
    pub seed: Option<BytesN<32>>,
    pub players: Vec<PlayerView>,
    pub bid_history: Vec<Bid>,
    pub current_bid: Vec<Bid>, // 0 or 1 elements; empty == no current bid
    pub challenger: Option<u32>,
    pub turn: u32,
    pub outcome: Option<u32>,
}

// ---------- storage keys ----------

fn key_verifier() -> Symbol {
    symbol_short!("verifier")
}
fn key_nplayers() -> Symbol {
    symbol_short!("nplayers")
}
fn key_dicen() -> Symbol {
    symbol_short!("dicen")
}
fn key_sides() -> Symbol {
    symbol_short!("sides")
}
fn key_phase() -> Symbol {
    symbol_short!("phase")
}
fn key_seed() -> Symbol {
    symbol_short!("seed")
}
fn key_players() -> Symbol {
    symbol_short!("players")
}
fn key_bidlog() -> Symbol {
    symbol_short!("bidlog")
}
fn key_curbid() -> Symbol {
    symbol_short!("curbid")
}
fn key_challgr() -> Symbol {
    symbol_short!("chlgr")
}
fn key_turn() -> Symbol {
    symbol_short!("turn")
}
fn key_outcome() -> Symbol {
    symbol_short!("outcome")
}

// ---------- field helpers (must byte-match graph-tools / the dice_valid circuit) ----------

/// Poseidon2 2-to-1 hash, byte-identical to referee.rs / graph-tools / the Noir circuit.
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

/// 32-byte big-endian encoding of a u32, high bytes zero — the same field
/// representation `zktable-graph`'s `be32(&BigUint)` produces for a small
/// decimal value passed e.g. as `--player 0`.
fn be32(x: u32) -> [u8; 32] {
    let mut a = [0u8; 32];
    a[28..32].copy_from_slice(&x.to_be_bytes());
    a
}

fn zero32(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
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

fn all_by<F: Fn(&PlayerData) -> bool>(players: &Vec<PlayerData>, f: F) -> bool {
    for i in 0..players.len() {
        if !f(&players.get(i).unwrap()) {
            return false;
        }
    }
    true
}

#[contractimpl]
impl LiarsDiceRefereeContract {
    /// Set config once at deploy. `n_players` must be 2, `dice_per_player`
    /// must be 5, `sides` must be 6 — the only values matching the fixed
    /// `dice_valid` circuit and this v1 referee's single-round soundness
    /// (see module doc).
    pub fn __constructor(
        env: Env,
        verifier: Address,
        n_players: u32,
        dice_per_player: u32,
        sides: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&key_verifier()) {
            return Err(Error::AlreadyInitialized);
        }
        if n_players != N_PLAYERS || dice_per_player != DICE_N || sides != SIDES {
            return Err(Error::UnsupportedConfig);
        }
        env.storage().instance().set(&key_verifier(), &verifier);
        env.storage().instance().set(&key_nplayers(), &n_players);
        env.storage().instance().set(&key_dicen(), &dice_per_player);
        env.storage().instance().set(&key_sides(), &sides);
        set_phase(&env, Phase::CommitNonce);

        let mut players: Vec<PlayerData> = Vec::new(&env);
        for _ in 0..n_players {
            players.push_back(PlayerData {
                nonce_commitment: None,
                nonce: None,
                dice_commitments: Vec::new(&env),
                revealed_dice: Vec::new(&env),
                alive: true,
            });
        }
        set_players(&env, &players);

        let empty_bids: Vec<Bid> = Vec::new(&env);
        env.storage().instance().set(&key_bidlog(), &empty_bids);
        let empty_curbid: Vec<Bid> = Vec::new(&env);
        env.storage().instance().set(&key_curbid(), &empty_curbid);
        env.storage().instance().set(&key_turn(), &0u32);
        Ok(())
    }

    /// Phase 1: commit `hash2(nonce, 0)`. Once every player has committed,
    /// advances to `RevealNonce`.
    pub fn commit_nonce(env: Env, player: u32, nonce_commitment: BytesN<32>) -> Result<(), Error> {
        if get_phase(&env) != Phase::CommitNonce {
            return Err(Error::WrongPhase);
        }
        let mut players = get_players(&env);
        let mut p = players.get(player).ok_or(Error::BadPlayerIndex)?;
        if p.nonce_commitment.is_some() {
            return Err(Error::AlreadyCommitted);
        }
        p.nonce_commitment = Some(nonce_commitment);
        players.set(player, p);

        if all_by(&players, |p| p.nonce_commitment.is_some()) {
            set_phase(&env, Phase::RevealNonce);
        }
        set_players(&env, &players);
        Ok(())
    }

    /// Phase 2: reveal the nonce behind a committed `hash2(nonce, 0)`. Once
    /// every player has revealed, computes `seed = fold_seed(nonces)` (the
    /// same left-fold `zktable-graph seed`/the circuit's derivation use, in
    /// player-index order) and advances to `Roll`.
    pub fn reveal_nonce(env: Env, player: u32, nonce: BytesN<32>) -> Result<(), Error> {
        if get_phase(&env) != Phase::RevealNonce {
            return Err(Error::WrongPhase);
        }
        let mut players = get_players(&env);
        let mut p = players.get(player).ok_or(Error::BadPlayerIndex)?;
        if p.nonce.is_some() {
            return Err(Error::AlreadyNonceRevealed);
        }
        let commitment = p.nonce_commitment.clone().ok_or(Error::NotFullyCommitted)?;
        let zero = zero32(&env);
        let computed = poseidon2_hash2(&env, &nonce, &zero);
        if computed != commitment {
            return Err(Error::NonceRevealMismatch);
        }
        p.nonce = Some(nonce);
        players.set(player, p);

        if all_by(&players, |p| p.nonce.is_some()) {
            let mut acc = zero32(&env);
            for i in 0..players.len() {
                let n = players.get(i).unwrap().nonce.clone().unwrap();
                acc = poseidon2_hash2(&env, &acc, &n);
            }
            env.storage().instance().set(&key_seed(), &acc);
            set_phase(&env, Phase::Roll);
        }
        set_players(&env, &players);
        Ok(())
    }

    /// Phase 3: submit a `dice_valid` proof for this player's 5 dice
    /// commitments. Builds `public_inputs = seed | be32(player) | c_0..c_4`
    /// from the referee's OWN stored `seed` (never client-supplied) and
    /// verifies cross-contract. Once every player has rolled, advances to
    /// `Bid` and sets `turn` to the first alive player.
    pub fn submit_dice(
        env: Env,
        player: u32,
        commitments: Vec<BytesN<32>>,
        proof: Bytes,
    ) -> Result<(), Error> {
        if get_phase(&env) != Phase::Roll {
            return Err(Error::WrongPhase);
        }
        if commitments.len() != DICE_N {
            return Err(Error::BadArrayLength);
        }
        let mut players = get_players(&env);
        let mut p = players.get(player).ok_or(Error::BadPlayerIndex)?;
        if !p.dice_commitments.is_empty() {
            return Err(Error::AlreadyRolled);
        }
        let seed: BytesN<32> = env
            .storage()
            .instance()
            .get(&key_seed())
            .ok_or(Error::WrongPhase)?;

        let mut public_inputs = Bytes::new(&env);
        public_inputs.append(&Bytes::from_array(&env, &seed.to_array()));
        public_inputs.append(&Bytes::from_array(&env, &be32(player)));
        for i in 0..commitments.len() {
            public_inputs.append(&Bytes::from_array(&env, &commitments.get(i).unwrap().to_array()));
        }

        let verifier: Address = env.storage().instance().get(&key_verifier()).unwrap();
        verify_proof(&env, &verifier, public_inputs, proof)?;

        p.dice_commitments = commitments;
        players.set(player, p);

        if all_by(&players, |p| !p.dice_commitments.is_empty()) {
            set_phase(&env, Phase::Bid);
            let first = first_alive(&players);
            env.storage().instance().set(&key_turn(), &first);
        }
        set_players(&env, &players);
        Ok(())
    }

    /// Bid: the current-turn player raises the standing bid. Must strictly
    /// escalate (higher quantity, or same quantity + higher face); the first
    /// bid of a round need only be a valid `(quantity >= 1, face in [1,
    /// sides])` pair.
    pub fn bid(env: Env, player: u32, quantity: u32, face: u32) -> Result<(), Error> {
        if get_phase(&env) != Phase::Bid {
            return Err(Error::WrongPhase);
        }
        check_turn(&env, player)?;
        let sides: u32 = env.storage().instance().get(&key_sides()).unwrap();
        if face < 1 || face > sides {
            return Err(Error::InvalidFace);
        }
        if quantity < 1 {
            return Err(Error::BidDoesNotEscalate);
        }
        let current: Vec<Bid> = env
            .storage()
            .instance()
            .get(&key_curbid())
            .unwrap_or_else(|| Vec::new(&env));
        if let Some(cur) = current.get(0) {
            let escalates = quantity > cur.quantity || (quantity == cur.quantity && face > cur.face);
            if !escalates {
                return Err(Error::BidDoesNotEscalate);
            }
        }
        let new_bid = Bid { player, quantity, face };
        let mut new_current: Vec<Bid> = Vec::new(&env);
        new_current.push_back(new_bid.clone());
        env.storage().instance().set(&key_curbid(), &new_current);
        let mut log: Vec<Bid> = env.storage().instance().get(&key_bidlog()).unwrap();
        log.push_back(new_bid);
        env.storage().instance().set(&key_bidlog(), &log);

        let players = get_players(&env);
        advance_turn(&env, &players, player);
        Ok(())
    }

    /// The current-turn player challenges the standing bid instead of
    /// bidding. Opens the reveal phase.
    pub fn challenge(env: Env, player: u32) -> Result<(), Error> {
        if get_phase(&env) != Phase::Bid {
            return Err(Error::WrongPhase);
        }
        check_turn(&env, player)?;
        let current: Vec<Bid> = env
            .storage()
            .instance()
            .get(&key_curbid())
            .unwrap_or_else(|| Vec::new(&env));
        if current.is_empty() {
            return Err(Error::NoCurrentBid);
        }
        env.storage().instance().set(&key_challgr(), &player);
        set_phase(&env, Phase::Reveal);
        Ok(())
    }

    /// Reveal phase: open this player's 5 dice + salts; checked against the
    /// stored `dice_valid` commitments (`hash2(be32(d_j), salt_j) == c_j`).
    /// Once every player has revealed, resolves the challenge.
    pub fn reveal_dice(env: Env, player: u32, dice: Vec<u32>, salts: Vec<BytesN<32>>) -> Result<(), Error> {
        if get_phase(&env) != Phase::Reveal {
            return Err(Error::WrongPhase);
        }
        if dice.len() != DICE_N || salts.len() != DICE_N {
            return Err(Error::BadArrayLength);
        }
        let mut players = get_players(&env);
        let mut p = players.get(player).ok_or(Error::BadPlayerIndex)?;
        if !p.revealed_dice.is_empty() {
            return Err(Error::AlreadyDiceRevealed);
        }
        let commitments = p.dice_commitments.clone();
        if commitments.is_empty() {
            return Err(Error::WrongPhase);
        }
        for i in 0..DICE_N {
            let d = dice.get(i).unwrap();
            let s = salts.get(i).unwrap();
            let d_bytes = BytesN::from_array(&env, &be32(d));
            let computed = poseidon2_hash2(&env, &d_bytes, &s);
            if computed != commitments.get(i).unwrap() {
                return Err(Error::DiceRevealMismatch);
            }
        }
        p.revealed_dice = dice;
        players.set(player, p);
        set_players(&env, &players);

        let players = get_players(&env);
        if all_by(&players, |p| !p.revealed_dice.is_empty()) {
            resolve(&env, players);
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
                committed: p.nonce_commitment.is_some(),
                nonce_revealed: p.nonce.is_some(),
                rolled: !p.dice_commitments.is_empty(),
                dice_commitments: p.dice_commitments.clone(),
                revealed_dice: p.revealed_dice.clone(),
                alive: p.alive,
            });
        }
        GameState {
            phase: get_phase(&env),
            n_players: env.storage().instance().get(&key_nplayers()).unwrap(),
            dice_per_player: env.storage().instance().get(&key_dicen()).unwrap(),
            sides: env.storage().instance().get(&key_sides()).unwrap(),
            seed: env.storage().instance().get(&key_seed()),
            players: views,
            bid_history: env
                .storage()
                .instance()
                .get(&key_bidlog())
                .unwrap_or_else(|| Vec::new(&env)),
            current_bid: env
                .storage()
                .instance()
                .get(&key_curbid())
                .unwrap_or_else(|| Vec::new(&env)),
            challenger: env.storage().instance().get(&key_challgr()),
            turn: get_turn(&env),
            outcome: env.storage().instance().get(&key_outcome()),
        }
    }
}

/// Resolves a challenge once every player has revealed: counts exact-face
/// matches (v1: no wild ones, documented) against the challenged bid's
/// `(quantity, face)`. If the count meets or exceeds the bid quantity the
/// CHALLENGER loses; otherwise the last BIDDER loses. The loser is
/// eliminated; since `n_players == N_PLAYERS == 2` is enforced at
/// construction, exactly one player remains alive, so this always yields a
/// definitive winner and the game ends (`Finished`).
fn resolve(env: &Env, mut players: Vec<PlayerData>) {
    let current: Vec<Bid> = env.storage().instance().get(&key_curbid()).unwrap();
    let bid = current.get(0).unwrap();
    let mut count = 0u32;
    for i in 0..players.len() {
        let dice = players.get(i).unwrap().revealed_dice;
        for j in 0..dice.len() {
            if dice.get(j).unwrap() == bid.face {
                count += 1;
            }
        }
    }

    let loser = if count >= bid.quantity {
        env.storage().instance().get::<_, u32>(&key_challgr()).unwrap()
    } else {
        bid.player
    };
    let mut loser_p = players.get(loser).unwrap();
    loser_p.alive = false;
    players.set(loser, loser_p);
    set_players(env, &players);

    let mut winner: Option<u32> = None;
    let mut alive_count = 0u32;
    for i in 0..players.len() {
        if players.get(i).unwrap().alive {
            alive_count += 1;
            winner = Some(i);
        }
    }
    if alive_count == 1 {
        env.storage().instance().set(&key_outcome(), &winner.unwrap());
        set_phase(env, Phase::Finished);
    }
    // alive_count > 1 is unreachable given the constructor's N_PLAYERS == 2
    // enforcement (a single elimination from 2 always leaves exactly 1); left
    // un-handled deliberately rather than silently mis-resolving a
    // multi-round tournament this v1 does not implement (see module doc).
}
