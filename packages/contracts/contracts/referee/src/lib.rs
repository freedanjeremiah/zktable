#![no_std]
extern crate alloc;

use soroban_poseidon::{poseidon2_hash, Field};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, crypto::BnScalar, symbol_short, Address,
    Bytes, BytesN, Env, InvokeError, IntoVal, Symbol, Val, Vec,
};
use ultrahonk_soroban_verifier::PROOF_BYTES;

#[contract]
pub struct RefereeContract;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotLobbyPhase = 2,
    NotActive = 3,
    NotYourTurn = 4,
    WrongRole = 5,
    NoTicket = 6,
    VerificationFailed = 7,
    RevealMismatch = 8,
    BadPlayerIndex = 9,
    NoStartPosition = 10,
    InvalidRole = 11,
    InvalidTicket = 12,
    InvalidRoster = 13,
    NotRevealRound = 14,
    ProofSizeMismatch = 15,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    Lobby,
    Active,
    Finished,
}

#[contracttype]
#[derive(Clone)]
pub struct PlayerData {
    pub address: Address,
    pub role: Symbol,
    pub public_node: Option<u32>,
    pub hidden_commitment: Option<BytesN<32>>,
    pub ticket_taxi: u32,
    pub ticket_bus: u32,
    pub ticket_rail: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PlayerView {
    pub address: Address,
    pub role: Symbol,
    pub public_node: Option<u32>,
    pub hidden_commitment: Option<BytesN<32>>,
    pub resources: (u32, u32, u32),
}

#[contracttype]
#[derive(Clone)]
pub struct GameState {
    pub status: Status,
    pub round: u32,
    pub turn_index: u32,
    pub current_player: u32,
    pub ticket_feed: Vec<u32>,
    pub reveal_log: Vec<(u32, u32)>,
    pub players: Vec<PlayerView>,
    pub outcome: Option<Symbol>,
}

// ---------- storage keys ----------

fn key_verifier() -> Symbol {
    symbol_short!("verifier")
}
fn key_groot() -> Symbol {
    symbol_short!("groot")
}
fn key_nrounds() -> Symbol {
    symbol_short!("nrounds")
}
fn key_rrounds() -> Symbol {
    symbol_short!("rrounds")
}
fn key_status() -> Symbol {
    symbol_short!("status")
}
fn key_round() -> Symbol {
    symbol_short!("round")
}
fn key_turnidx() -> Symbol {
    symbol_short!("turnidx")
}
fn key_order() -> Symbol {
    symbol_short!("order")
}
fn key_players() -> Symbol {
    symbol_short!("players")
}
fn key_feed() -> Symbol {
    symbol_short!("feed")
}
fn key_revlog() -> Symbol {
    symbol_short!("revlog")
}
fn key_outcome() -> Symbol {
    symbol_short!("outcome")
}

fn phantom_sym(env: &Env) -> Symbol {
    Symbol::new(env, "phantom")
}
fn investigator_sym(env: &Env) -> Symbol {
    Symbol::new(env, "investigator")
}

// ---------- field helpers (must byte-match graph-tools / circuit) ----------

/// Poseidon2 2-to-1 hash, byte-identical to mixer.rs / graph-tools / the Noir circuit.
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

/// 32-byte big-endian encoding of a u32, high bytes zero. Matches
/// `BigUint::from(ticket)` -> be32 in graph-tools.
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

fn get_status(env: &Env) -> Status {
    env.storage().instance().get(&key_status()).unwrap()
}
fn set_status(env: &Env, s: Status) {
    env.storage().instance().set(&key_status(), &s);
}
fn get_players(env: &Env) -> Vec<PlayerData> {
    env.storage()
        .instance()
        .get(&key_players())
        .unwrap_or_else(|| Vec::new(env))
}
fn set_players(env: &Env, players: &Vec<PlayerData>) {
    env.storage().instance().set(&key_players(), players);
}
fn get_order(env: &Env) -> Vec<u32> {
    env.storage()
        .instance()
        .get(&key_order())
        .unwrap_or_else(|| Vec::new(env))
}
fn get_turn_index(env: &Env) -> u32 {
    env.storage().instance().get(&key_turnidx()).unwrap_or(0)
}
fn get_round(env: &Env) -> u32 {
    env.storage().instance().get(&key_round()).unwrap_or(0)
}

/// Advances turn_index to the next player in `order`; wraps to 0 and bumps
/// `round` when the order is exhausted.
fn settle_turn(env: &Env) {
    let order = get_order(env);
    let mut turn_index = get_turn_index(env);
    turn_index += 1;
    if turn_index >= order.len() {
        turn_index = 0;
        let round = get_round(env);
        env.storage().instance().set(&key_round(), &(round + 1));
    }
    env.storage().instance().set(&key_turnidx(), &turn_index);
}

/// Confirms `player` is the index whose turn it currently is.
fn check_turn(env: &Env, player: u32) -> Result<(), Error> {
    let order = get_order(env);
    let turn_index = get_turn_index(env);
    let current = order.get(turn_index).ok_or(Error::NotYourTurn)?;
    if current != player {
        return Err(Error::NotYourTurn);
    }
    Ok(())
}

/// Loads the seat and requires its owner's authorization. Every per-seat
/// entry point calls this before touching state; `join`/`start` stay
/// permissionless (enrolling an address costs it nothing — the trust
/// boundary is per-seat actions, see docs/superpowers/specs M8.1).
fn require_seat_auth(players: &Vec<PlayerData>, player: u32) -> Result<PlayerData, Error> {
    let p = players.get(player).ok_or(Error::BadPlayerIndex)?;
    p.address.require_auth();
    Ok(p)
}

fn decrement_ticket(p: &mut PlayerData, ticket: u32) -> Result<(), Error> {
    let count = match ticket {
        0 => &mut p.ticket_taxi,
        1 => &mut p.ticket_bus,
        2 => &mut p.ticket_rail,
        _ => return Err(Error::InvalidTicket),
    };
    if *count == 0 {
        return Err(Error::NoTicket);
    }
    *count -= 1;
    Ok(())
}

#[contractimpl]
impl RefereeContract {
    /// Set config once at deploy. `graph_root` is the off-chain edge-tree root
    /// `G`; `reveal_rounds` are the 1-indexed rounds at which the phantom must
    /// call `reveal`.
    pub fn __constructor(
        env: Env,
        verifier: Address,
        graph_root: BytesN<32>,
        n_rounds: u32,
        reveal_rounds: Vec<u32>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&key_verifier()) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&key_verifier(), &verifier);
        env.storage().instance().set(&key_groot(), &graph_root);
        env.storage().instance().set(&key_nrounds(), &n_rounds);
        env.storage().instance().set(&key_rrounds(), &reveal_rounds);
        set_status(&env, Status::Lobby);
        env.storage().instance().set(&key_round(), &0u32);
        env.storage().instance().set(&key_turnidx(), &0u32);
        set_players(&env, &Vec::new(&env));
        let empty_feed: Vec<u32> = Vec::new(&env);
        env.storage().instance().set(&key_feed(), &empty_feed);
        let empty_log: Vec<(u32, u32)> = Vec::new(&env);
        env.storage().instance().set(&key_revlog(), &empty_log);
        Ok(())
    }

    /// Adds a player to the roster (Lobby phase only). Returns the assigned
    /// player index (join order).
    pub fn join(
        env: Env,
        addr: Address,
        role: Symbol,
        ticket_taxi: u32,
        ticket_bus: u32,
        ticket_rail: u32,
    ) -> Result<u32, Error> {
        if get_status(&env) != Status::Lobby {
            return Err(Error::NotLobbyPhase);
        }
        if role != phantom_sym(&env) && role != investigator_sym(&env) {
            return Err(Error::InvalidRole);
        }
        let mut players = get_players(&env);
        let idx = players.len();
        players.push_back(PlayerData {
            address: addr,
            role,
            public_node: None,
            hidden_commitment: None,
            ticket_taxi,
            ticket_bus,
            ticket_rail,
        });
        set_players(&env, &players);
        Ok(idx)
    }

    /// Sets the phantom's initial hidden-position commitment (Lobby only).
    pub fn set_hidden_start(env: Env, player: u32, commitment: BytesN<32>) -> Result<(), Error> {
        if get_status(&env) != Status::Lobby {
            return Err(Error::NotLobbyPhase);
        }
        let mut players = get_players(&env);
        let mut p = require_seat_auth(&players, player)?;
        if p.role != phantom_sym(&env) {
            return Err(Error::WrongRole);
        }
        p.hidden_commitment = Some(commitment);
        players.set(player, p);
        set_players(&env, &players);
        Ok(())
    }

    /// Sets an investigator's initial public node (Lobby only).
    pub fn set_public_start(env: Env, player: u32, node: u32) -> Result<(), Error> {
        if get_status(&env) != Status::Lobby {
            return Err(Error::NotLobbyPhase);
        }
        let mut players = get_players(&env);
        let mut p = require_seat_auth(&players, player)?;
        if p.role != investigator_sym(&env) {
            return Err(Error::WrongRole);
        }
        p.public_node = Some(node);
        players.set(player, p);
        set_players(&env, &players);
        Ok(())
    }

    /// Locks the roster: turn order = phantom first, then investigators in
    /// join order. Requires exactly one phantom, at least one investigator,
    /// and every player to have a start position set.
    pub fn start(env: Env) -> Result<(), Error> {
        if get_status(&env) != Status::Lobby {
            return Err(Error::NotLobbyPhase);
        }
        let players = get_players(&env);
        let n = players.len();
        let mut phantom_idx: Option<u32> = None;
        let mut order: Vec<u32> = Vec::new(&env);
        // Two passes: first find the phantom (turn order requires phantom
        // first), then append investigators in join order.
        for i in 0..n {
            let p = players.get(i).unwrap();
            if p.role == phantom_sym(&env) {
                if phantom_idx.is_some() {
                    return Err(Error::InvalidRoster);
                }
                if p.hidden_commitment.is_none() {
                    return Err(Error::NoStartPosition);
                }
                phantom_idx = Some(i);
            } else if p.public_node.is_none() {
                return Err(Error::NoStartPosition);
            }
        }
        let phantom_idx = phantom_idx.ok_or(Error::InvalidRoster)?;
        order.push_back(phantom_idx);
        let mut investigator_count = 0u32;
        for i in 0..n {
            if i == phantom_idx {
                continue;
            }
            order.push_back(i);
            investigator_count += 1;
        }
        if investigator_count == 0 {
            return Err(Error::InvalidRoster);
        }
        env.storage().instance().set(&key_order(), &order);
        env.storage().instance().set(&key_round(), &1u32);
        env.storage().instance().set(&key_turnidx(), &0u32);
        set_status(&env, Status::Active);
        Ok(())
    }

    /// Phantom hidden move. Builds `public_inputs = c_old ++ c_new ++
    /// be32(ticket) ++ graph_root` from OWN stored `c_old`/`graph_root` (never
    /// client-supplied) and verifies the proof via the verifier contract. On
    /// success: stores `c_new`, decrements the ticket, records it to the
    /// public feed, and settles the turn.
    pub fn submit_hidden_move(
        env: Env,
        player: u32,
        c_new: BytesN<32>,
        ticket: u32,
        proof: Bytes,
    ) -> Result<(), Error> {
        if get_status(&env) != Status::Active {
            return Err(Error::NotActive);
        }
        check_turn(&env, player)?;
        let mut players = get_players(&env);
        let mut p = require_seat_auth(&players, player)?;
        if p.role != phantom_sym(&env) {
            return Err(Error::WrongRole);
        }
        let c_old = p.hidden_commitment.clone().ok_or(Error::NoStartPosition)?;
        // Validate ticket type before spending compute on verification.
        if ticket > 2 {
            return Err(Error::InvalidTicket);
        }
        let ticket_count = match ticket {
            0 => p.ticket_taxi,
            1 => p.ticket_bus,
            _ => p.ticket_rail,
        };
        if ticket_count == 0 {
            return Err(Error::NoTicket);
        }
        let graph_root: BytesN<32> = env.storage().instance().get(&key_groot()).unwrap();

        // public_inputs = c_old | c_new | be32(ticket) | graph_root (128 bytes),
        // built entirely from OUR stored state (c_old, graph_root) so a proof
        // for a different position/graph is rejected by the verifier.
        let mut public_inputs = Bytes::new(&env);
        public_inputs.append(&Bytes::from_array(&env, &c_old.to_array()));
        public_inputs.append(&Bytes::from_array(&env, &c_new.to_array()));
        public_inputs.append(&Bytes::from_array(&env, &be32(ticket)));
        public_inputs.append(&Bytes::from_array(&env, &graph_root.to_array()));

        let verifier: Address = env.storage().instance().get(&key_verifier()).unwrap();
        verify_proof(&env, &verifier, public_inputs, proof)?;

        decrement_ticket(&mut p, ticket)?;
        p.hidden_commitment = Some(c_new);
        players.set(player, p);
        set_players(&env, &players);

        let mut feed: Vec<u32> = env.storage().instance().get(&key_feed()).unwrap();
        feed.push_back(ticket);
        env.storage().instance().set(&key_feed(), &feed);

        settle_turn(&env);
        Ok(())
    }

    /// Investigator public move. Adjacency legality is enforced OFF-CHAIN by
    /// the engine (v1 simplification, PRD §12.2). On-chain this enforces turn
    /// order/role, spends a ticket, and records the move; capture is resolved
    /// only at `reveal`.
    pub fn submit_public_move(env: Env, player: u32, node: u32, ticket: u32) -> Result<(), Error> {
        if get_status(&env) != Status::Active {
            return Err(Error::NotActive);
        }
        check_turn(&env, player)?;
        let mut players = get_players(&env);
        let mut p = require_seat_auth(&players, player)?;
        if p.role != investigator_sym(&env) {
            return Err(Error::WrongRole);
        }
        decrement_ticket(&mut p, ticket)?;
        p.public_node = Some(node);
        players.set(player, p);
        set_players(&env, &players);

        let mut feed: Vec<u32> = env.storage().instance().get(&key_feed()).unwrap();
        feed.push_back(ticket);
        env.storage().instance().set(&key_feed(), &feed);

        settle_turn(&env);
        Ok(())
    }

    /// Phantom reveal at a reveal round. Checks
    /// `poseidon2_hash2(be32(node), salt) == stored_commitment`; on success
    /// publishes to the reveal log and resolves capture: if any
    /// investigator's current node == `node`, investigators win. If this is
    /// the final reveal round (`round == n_rounds`) and not captured, the
    /// phantom wins.
    pub fn reveal(env: Env, player: u32, node: u32, salt: BytesN<32>) -> Result<(), Error> {
        if get_status(&env) != Status::Active {
            return Err(Error::NotActive);
        }
        let players = get_players(&env);
        let p = require_seat_auth(&players, player)?;
        if p.role != phantom_sym(&env) {
            return Err(Error::WrongRole);
        }
        let stored_commitment = p.hidden_commitment.clone().ok_or(Error::NoStartPosition)?;

        let round = get_round(&env);
        let reveal_rounds: Vec<u32> = env.storage().instance().get(&key_rrounds()).unwrap();
        let mut is_reveal_round = false;
        for r in reveal_rounds.iter() {
            if r == round {
                is_reveal_round = true;
                break;
            }
        }
        if !is_reveal_round {
            return Err(Error::NotRevealRound);
        }

        let node_bytes = BytesN::from_array(&env, &be32(node));
        let computed = poseidon2_hash2(&env, &node_bytes, &salt);
        if computed != stored_commitment {
            return Err(Error::RevealMismatch);
        }

        let mut log: Vec<(u32, u32)> = env.storage().instance().get(&key_revlog()).unwrap();
        log.push_back((round, node));
        env.storage().instance().set(&key_revlog(), &log);

        let mut captured = false;
        for i in 0..players.len() {
            let pi = players.get(i).unwrap();
            if pi.role == investigator_sym(&env) && pi.public_node == Some(node) {
                captured = true;
                break;
            }
        }

        let n_rounds: u32 = env.storage().instance().get(&key_nrounds()).unwrap();
        if captured {
            set_status(&env, Status::Finished);
            env.storage()
                .instance()
                .set(&key_outcome(), &investigator_sym(&env));
        } else if round == n_rounds {
            set_status(&env, Status::Finished);
            env.storage()
                .instance()
                .set(&key_outcome(), &phantom_sym(&env));
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
                address: p.address,
                role: p.role,
                public_node: p.public_node,
                hidden_commitment: p.hidden_commitment,
                resources: (p.ticket_taxi, p.ticket_bus, p.ticket_rail),
            });
        }
        let order = get_order(&env);
        let turn_index = get_turn_index(&env);
        let current_player = order.get(turn_index).unwrap_or(0);
        let ticket_feed: Vec<u32> = env
            .storage()
            .instance()
            .get(&key_feed())
            .unwrap_or_else(|| Vec::new(&env));
        let reveal_log: Vec<(u32, u32)> = env
            .storage()
            .instance()
            .get(&key_revlog())
            .unwrap_or_else(|| Vec::new(&env));
        let outcome: Option<Symbol> = env.storage().instance().get(&key_outcome());
        GameState {
            status: get_status(&env),
            round: get_round(&env),
            turn_index,
            current_player,
            ticket_feed,
            reveal_log,
            players: views,
            outcome,
        }
    }
}
