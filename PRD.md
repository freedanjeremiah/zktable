# zkTable — Master PRD

> **A TypeScript SDK for building trustless, privacy-preserving board games on Stellar.**
> You declare a game; you get zero-knowledge privacy, on-chain state, and AI opponents for free — without ever writing a circuit.

**Status:** Design complete, pre-implementation.
**Document type:** Single master PRD. This is the only document you need to start building. It is written to be picked up cold by an engineer or agent with **zero prior context**.
**Last updated:** 2026-07-03

---

## 0. How to read this document

- **Sections 1–4** = why this exists, what "done" means, and the mental model. Read once.
- **Sections 5–11** = the actual system: SDK API, ZK modules, on-chain contract, engine, AI. This is your build spec.
- **Sections 12–14** = the flagship game, the other example games, and the web app/UX.
- **Sections 15–19** = stack, repo layout, security model, testing, and the **phased build order with acceptance criteria** (Section 18 is your day-1 checklist).
- **Section 20** = glossary + references (every external doc/repo you'll need).

If you are an agent starting fresh: read Sections 3, 4, 5, 15, 16, then jump to **Section 18 (Build Order)** and begin at Milestone M0.

---

## 1. One-paragraph pitch

Every trustless board game needs the same plumbing: hide secret information, prove moves are legal without revealing the secret, generate provably-fair randomness, and keep authoritative state somewhere nobody can tamper with. Today every team rebuilds this from scratch. **zkTable is the framework that makes it a library call.** A developer writes an ordinary declarative game definition; the SDK compiles it to pre-built, audited zero-knowledge circuits (Noir), deploys a generic referee smart contract on Stellar (Soroban), and gives every game AI opponents that — because they pass through the exact same ZK boundary as human players — *literally cannot cheat*. We prove the SDK is real by shipping an arcade of very different games on top of it, headlined by a Scotland-Yard-style hidden-pursuit game with beautiful UX.

---

## 2. Background & competitive context

This project targets the Stellar "Real-World ZK" hackathon lineage. Stellar recently shipped the cryptographic foundation modern ZK needs:

- **Protocol 25 ("X-Ray")** — native host functions for ZK-friendly primitives: BN254 elliptic-curve operations and **Poseidon/Poseidon2 hashing**.
- **Protocol 26 ("Yardstick")** — nine more BN254 host functions (multi-scalar multiplication, scalar-field arithmetic, curve-membership checks), moving heavy ZK math into the host layer and making proof verification (including NoirLang proofs) meaningfully cheaper on-chain.
- Plus **BLS12-381** from earlier protocols.

Net effect: Stellar can now verify zk-SNARK proofs efficiently and cheaply inside a Soroban contract, and **Poseidon commitments are cheap to check on-chain**.

**What the previous ZK-gaming hackathon (99 submissions) taught us** — direct competitive intelligence that shapes our strategy:

| Rank | Project | What it was |
|---|---|---|
| 🥇 1st | Chickenz.io | Real-time competitive platformer; off-chain compute verified on-chain |
| 🥈 2nd | xray.games | A trustless *arcade*; skill proven on-chain |
| 🥉 3rd | Stellar Poker | Verifiably-private poker (coSNARKs) |
| 4th | Cosmic Coders | Provable-fairness gaming infra |
| 5th | DarkWater ZK | ZK Battleship |

Key lessons, and how zkTable exploits each:

1. **The field drowned in single hidden-info games** — 6+ Battleships, 3 Pokers, many Mafia/Stratego clones. Everyone rebuilt identical commit-reveal + verifier plumbing. → **zkTable's entire reason to exist:** turn that plumbing into a library. Our pitch: *"the SDK that would have let all 99 teams ship in a weekend."*
2. **Winners won on platform/arcade framing + polish, not on the most literal hidden game.** → We ship the **SDK + an arcade** of games, not one game. This mirrors what took 1st and 2nd.
3. **Only one project touched AI agents; it didn't place. Polish was underweighted.** → **AI opponents + genuinely good UX** are our cheap, open differentiators.
4. **Hidden *movement* on a graph was essentially undone** (everyone hid *static* things). → Our flagship hides a *moving position*, a novel and more impressive circuit.

---

## 3. Goals, non-goals, scope boundary

### 3.1 Goals (what success looks like)
- **G1 — Production-quality general SDK.** A developer can define a new turn-based hidden-information board game by composing modules, without writing any ZK circuit or Soroban code. Target: a new simple game in **< 200 lines** of game-definition TypeScript.
- **G2 — Load-bearing ZK.** Every game's core secrecy/fairness is enforced by proofs verified in a Soroban contract. Remove the ZK and the game breaks. No "ZK on a slide."
- **G3 — On-chain trustless referee.** All authoritative state + all verification lives in a Soroban contract on Stellar testnet. No trusted server decides outcomes.
- **G4 — AI opponents that cannot cheat.** Ship a Claude-powered agent + a heuristic baseline behind one `Agent` interface; agents observe only public state + their own secret, and submit moves through the same proof path as humans.
- **G5 — Arcade of ≥ 3 visibly different games** on the SDK (flagship + two templates), proving generality.
- **G6 — Great UX.** A polished web app with wallet connect, live game boards, animated state, and clear "what is provably hidden" affordances.

### 3.2 Non-goals (explicitly out of scope for v1)
- Real-time / physics / twitch games (turn-based only).
- Arbitrary custom hidden logic with auto-generated circuits (we compose a fixed primitive set; a Noir escape hatch exists for advanced users but is not a v1 deliverable).
- Mainnet deployment, real-money wagering, tokenomics, matchmaking at scale.
- Mobile-native apps (responsive web is enough).
- Full mental-poker-grade deck security (the `deck` module ships a documented, honest simplification — see §7.2).

### 3.3 Scope boundary (what games the SDK can express)
**In:** turn-based board / card / dice games with hidden information — card games, dice games, hidden-movement/pursuit, social deduction, sealed-bid, fog-of-war grids.
**Out:** anything needing real-time updates, continuous space, or per-game bespoke circuits.

If a game can be expressed as *(public state) + (per-player secret state) + (turns that apply moves, where some moves depend on secrets and must be proven legal)*, zkTable can build it.

---

## 4. Core mental model — "compose, don't compile"

The naive dream is "declare any game → auto-synthesize a custom circuit." That is a research project and would sink this build. The insight that makes a **general** SDK actually shippable:

> Almost every board game is built from a small set of **information + randomness primitives**: hide a thing, randomize a thing, commit-then-reveal a thing, move a hidden thing legally, prove a hidden thing satisfies a rule. If the primitive set is rich and composable, developers express *any* board game by *composing pre-built, audited ZK modules* — never writing a circuit.

Generality therefore comes from a **rich composable primitive vocabulary**, not from magic. This is how boardgame.io, shader libraries, and query builders achieve open-ended power from a fixed set of primitives.

**The five primitives (the whole vocabulary):**

| Module | Board-game use | What the ZK proves |
|---|---|---|
| `dice` | rolls, spinners, random draws | roll is fair, unpredictable, and matches a commitment |
| `hidden` | secret hand / pieces / resources | a move is legal for a hidden value without revealing it |
| `deck` | shuffle & deal cards | everyone got distinct cards from a valid shuffle; nobody peeked |
| `sealed` | simultaneous moves, hidden bids | all players committed before anyone revealed |
| `board` | hidden movement on a graph/grid | a move follows a legal edge from a hidden position to a new hidden position |

Every game is these five, composed. The universal execution pattern for all of them:

```
   player / AI agent (off-chain)            Soroban contract (on-chain, the referee)
   ┌──────────────────────────┐             ┌─────────────────────────────────────┐
   │ holds secret state        │             │ stores public state + commitments   │
   │ chooses a move            │             │ turn order, ticket/resource counts  │
   │ builds witness            │  submit tx  │ VERIFIES the ZK proof   ✅ / ❌       │
   │ generates ZK proof  ──────┼────────────▶│ if valid → apply move, advance turn │
   └──────────────────────────┘             └─────────────────────────────────────┘
```

You cannot run a ZK *prover* on-chain (too expensive). So the rule is **prove off-chain, verify on-chain**, always. The contract never sees a secret — only a proof that the secret-dependent move was legal.

---

## 5. The SDK — general game model (`@zktable/core`)

A game is a **declarative definition**. The ZK, on-chain, and AI layers are derived from it automatically. This is the developer-facing surface and the heart of the product.

### 5.1 `defineGame` shape

```ts
import { defineGame, zk } from '@zktable/core'

const game = defineGame({
  name: 'my-game',

  // WHO plays. Roles enable asymmetry (e.g. hunter vs hunted).
  players: { min: 2, max: 6, roles?: string[] },

  // COMPONENTS — declarative pieces. Each maps to a ZK-aware type.
  components: {
    map?:    zk.board.graph(graphData),          // public graph/grid
    deck?:   zk.deck.of(cards),                   // a shuffleable deck
    dice?:   zk.dice.pool({ sides: 6 }),          // dice config
    tokens?: zk.resource({ taxi: 10, bus: 8 }),   // countable resources
  },

  // STATE — split into public (everyone sees) and per-player secret.
  state: {
    public: (ctx) => ({ round: 0, /* ... */ }),
    secret: (ctx) => ({ /* fields wrapped in zk.hidden.* are private */ }),
  },

  // SETUP — initial placement / deal, run once.
  setup: (ctx) => void,

  // TURN — order + the moves available, and how each is proven & applied.
  turn: {
    order: 'clockwise' | 'roles' | ((ctx) => PlayerId[]),
    phases?: Phase[],                              // optional multi-phase turns
    moves: Record<string, MoveSpec>,              // each move: validate + apply (+ proof binding)
  },

  // REVEAL — when hidden state must be opened (commit-reveal checkpoints).
  reveal?: { when: (state) => boolean, what: Path[] },

  // END — win/lose/draw detection.
  end: (state) => Outcome | null,
})
```

### 5.2 A `MoveSpec`

```ts
type MoveSpec = {
  // Which ZK module (if any) secures this move. Public moves omit `zkp`.
  zkp?: ZkBinding                     // e.g. zk.board.moveAlong(...), zk.sealed.commit(...)
  // Enumerate legal moves for a player given their view (public + own secret).
  // Used by the engine for UI affordances AND by AI agents.
  legal: (view: PlayerView) => Move[]
  // Pure reducer: apply a validated move to state. Runs identically off-chain
  // (for prediction/AI) and on-chain (authoritative), so it must be deterministic.
  apply: (state, move, ctx) => State
}
```

**Key discipline:** `apply` is a pure, deterministic reducer. It runs three places and must agree in all: (a) client for optimistic UI, (b) AI agent for lookahead, (c) Soroban contract for the authoritative update. The engine ships a TS reducer and a mirrored Rust reducer generated from the same move table (see §9).

### 5.3 Three games, one API (proof of generality)

```ts
// EXAMPLE 1 — Scotland-Yard-style pursuit (hidden MOVEMENT) — flagship, uses `board`
defineGame({
  name: 'blackout',
  players: { roles: ['phantom', 'investigator'], min: 2, max: 6 },
  components: { map: zk.board.graph(cityMap), tickets: zk.resource({taxi:10,bus:8,rail:4}) },
  state: {
    public: () => ({ round: 0, revealLog: [], ticketFeed: [] }),
    secret: ({ role }) => role === 'phantom'
      ? { pos: zk.hidden.node() }      // private, moving position
      : { pos: zk.public.node() },     // investigators are visible
  },
  turn: {
    order: 'roles',
    moves: {
      move: {
        zkp: zk.board.moveAlong('map', { announce: 'ticket', prove: 'legal-edge' }),
        legal: (v) => cityMap.edgesFrom(v.self.pos).filter(e => v.tickets[e.ticket] > 0),
        apply: (s, m) => applyMove(s, m),
      },
    },
  },
  reveal: { when: s => [3,8,13,18,24].includes(s.round), what: ['phantom.pos'] },
  end: s => caught(s) ? 'investigators' : s.round >= 24 ? 'phantom' : null,
})

// EXAMPLE 2 — Liar's Dice (hidden RANDOMNESS + bluff) — uses `dice` + `sealed`
defineGame({
  name: 'liars-dice',
  players: { min: 2, max: 6 },
  components: { dice: zk.dice.pool({ sides: 6 }) },
  state: { secret: () => ({ dice: zk.dice.rollHidden(5) }) },
  turn: {
    order: 'clockwise',
    moves: {
      bid:       { legal: bidsAbove, apply: setBid },                         // public escalating bid
      challenge: { zkp: zk.reveal.all('dice'), legal: () => [{t:'challenge'}], apply: resolve },
    },
  },
  end: s => s.playersLeft === 1 ? s.lastStanding : null,
})

// EXAMPLE 3 — Coup-lite (hidden DECK + bluff) — uses `deck` + `sealed`
defineGame({
  name: 'coup-lite',
  players: { min: 2, max: 4 },
  components: { court: zk.deck.of(CHARACTERS) },
  state: { secret: () => ({ hand: zk.deck.deal(2) }) },
  turn: {
    order: 'clockwise',
    moves: {
      claim:     { zkp: zk.sealed.commit(), legal: claimsFor, apply: applyClaim },
      challenge: { zkp: zk.deck.proveHoldOrBluff(), legal: () => [{t:'challenge'}], apply: resolveChallenge },
    },
  },
  end: s => s.alive.length === 1 ? s.alive[0] : null,
})
```

Three very different games; one API; **zero hand-written circuits.**

---

## 6. Deliverables (packages)

| Package | What it is |
|---|---|
| `@zktable/core` | The SDK: game model (`defineGame`), engine, module TS APIs, proof orchestration, agent harness. **The product.** |
| `@zktable/circuits` | Pre-built, audited Noir circuits — one per module — plus witness builders. Reused by every game. |
| `@zktable/contracts` | Generic Soroban referee contract (Rust) + the Noir (UltraHonk) verifier integration. Parameterized per game, not rewritten. |
| `@zktable/agents` | `Agent` interface + `HeuristicAgent` base + `ClaudeAgent`. |
| `@zktable/web` | The arcade web app (Next.js): lobby, game boards, wallet connect, AI play. |
| `games/*` | Example game definitions: `blackout` (flagship), `liars-dice`, `coup-lite`. |

---

## 7. The five ZK modules (circuit specs)

Each module below gives: **purpose**, **TS API**, **circuit public/private inputs**, **what it proves**, and **on-chain check**. All commitments use **Poseidon** (native host function → cheap on-chain). All proofs are **UltraHonk** (Noir) verified via the Soroban UltraHonk verifier (see §8, §15).

Notation: `C = Poseidon(value, salt)` is a hiding commitment. "Public" = proof public input, visible on-chain. "Private" = witness, never revealed.

### 7.1 `board` — hidden movement (flagship primitive)

- **Purpose:** prove a piece moved from a hidden position to a new hidden position along a legal edge of a public graph, using an announced transport type — without revealing either position.
- **TS API:** `zk.board.graph(data)`, `zk.board.moveAlong(component, { announce, prove })`, `zk.hidden.node()`, `zk.public.node()`.
- **Graph encoding:** adjacency compiled to a Merkle tree of valid edges `(from, to, ticket)`; the root `G` is a public constant per game/map. This keeps the circuit size independent of map size and makes any graph expressible.
- **Circuit `move_along`:**
  - Public: `C_old`, `C_new` (position commitments), `ticket` (announced transport), `G` (graph edge-root).
  - Private: `from`, `salt_old`, `to`, `salt_new`, `merkleProof(edge → G)`.
  - Proves: `Poseidon(from,salt_old)=C_old` ∧ `Poseidon(to,salt_new)=C_new` ∧ edge `(from,to,ticket)` ∈ tree under root `G`.
- **On-chain check:** contract holds current `C_old` for the piece; verifies the proof binds `C_old`, the announced `ticket`, and graph root `G`; on success stores `C_new` as the new position and pushes `ticket` to the public feed. Reveal turns: player submits `(pos, salt)`, contract checks `Poseidon(pos,salt)==C_new` and publishes `pos`.

### 7.2 `deck` — shuffle & deal

- **Purpose:** deal distinct cards from a shuffled deck without a trusted dealer; let a player prove they hold (or are bluffing about) a card.
- **TS API:** `zk.deck.of(cards)`, `zk.deck.shuffle()`, `zk.deck.deal(n)`, `zk.deck.proveHoldOrBluff()`.
- **v1 design (honest simplification — document clearly in README):** the deck order is a permutation seeded by combined player randomness (commit-reveal, §7.3 seed). A designated shuffler commits the permutation root and proves in ZK that it is a **valid bijection** over `[0,N)`. Each player's dealt cards are per-card commitments `C_i = Poseidon(card_i, salt_i)`; a player proves `card ∈ myHand` and `card == claimed` (hold) or the challenge reveals the mismatch (bluff). **Known limitation:** this is not full mental-poker/coSNARK security against a colluding shuffler; v1 assumes a semi-honest shuffle seed. State this plainly. (This module is **not** on the flagship's critical path; sequence it late — see §18 M6.)
- **Circuit `valid_shuffle`:** Public: permutation root `P`, `N`. Private: permutation array. Proves it is a bijection over `[0,N)`.
- **Circuit `card_membership`:** Public: `C_hand_root`, `claimedCard`. Private: `card`, `salt`, Merkle path. Proves the claimed card is in the committed hand.

### 7.3 `dice` — verifiable randomness

- **Purpose:** provably-fair rolls no player or server can predict or bias; rolls may be public or hidden.
- **TS API:** `zk.dice.pool({sides})`, `zk.dice.roll(n)` (public), `zk.dice.rollHidden(n)` (private, e.g. Liar's Dice).
- **Fair seed:** each participant commits `r_i = Poseidon(nonce_i)`; after all commit, all reveal `nonce_i`; `seed = Poseidon(nonce_1..nonce_k)`. No one can grind because commitments are locked before reveal.
- **Hidden roll:** player's die `d_j = (Poseidon(seed, playerId, j) mod sides) + 1`, committed `C_j = Poseidon(d_j, salt_j)`.
- **Circuit `dice_valid`:** Public: `seed`, `playerId`, `C_1..C_n`. Private: `d_j`, `salt_j`. Proves each `d_j` equals the PRF derivation from `seed` and `1 ≤ d_j ≤ sides` and matches `C_j`. On reveal, contract re-derives and checks.

### 7.4 `hidden` — secret state + legal-move predicate

- **Purpose:** the general "prove a move is legal for a secret value" primitive that `board`/`deck` specialize. Use directly for arbitrary hidden scalars/sets with a supported predicate (equality, range, membership, inequality).
- **TS API:** `zk.hidden.value()`, `zk.hidden.set()`, and predicates `zk.hidden.prove(pred)` where `pred ∈ {eq, range, member, gt, lt}`.
- **Circuit `predicate`:** Public: `C`, predicate params. Private: `value`, `salt`. Proves `Poseidon(value,salt)=C` ∧ `pred(value, params)`.

### 7.5 `sealed` — simultaneous commit-reveal

- **Purpose:** all players commit a hidden move; nobody can act on knowledge of another's move; reveal together.
- **TS API:** `zk.sealed.commit()`, `zk.sealed.reveal()`, `zk.reveal.all(path)`.
- **Flow:** phase 1 — every player submits `C_i = Poseidon(move_i, salt_i)` (contract records all before advancing). Phase 2 — everyone reveals `(move_i, salt_i)`; contract checks each against `C_i`, then applies. Optional ZK only if the *revealed* move must additionally satisfy a hidden predicate (compose with `hidden`).
- **On-chain check:** trivial Poseidon equality; the security is temporal (commit gate before any reveal), enforced by contract phase state.

---

## 8. On-chain layer — Soroban referee contract (`@zktable/contracts`)

**One generic contract pattern**, parameterized per game — not rewritten per game.

### 8.1 Responsibilities
- Hold authoritative **public state** + all **commitments** (hidden positions, sealed moves, dice/hand commitments).
- Enforce **turn order, phases, and resource counts** (tickets, etc.).
- **Verify proofs** by calling the UltraHonk verifier with the move's public inputs; reject invalid moves.
- Apply the **deterministic reducer** on success and advance the turn.
- Emit events for the web client (state deltas, reveals, game-over).

### 8.2 Storage model (per game instance)
```
GameState {
  id, config_hash,            // which game definition + map/deck roots
  players: [ {addr, role, resources} ],
  turn: {current, phase, round},
  public_state: bytes,        // serialized public state blob
  commitments: Map<Path, Commitment>,   // hidden positions / sealed moves / etc.
  status: Lobby | Active | Finished,
  outcome?: Outcome,
}
```

### 8.3 Contract interface (illustrative)
```rust
fn create_game(config_hash, roots) -> GameId
fn join(game, addr, role)
fn start(game)                                  // runs setup, locks roster
fn submit_move(game, move_public_inputs, proof) // verifies proof, applies reducer, advances turn
fn commit(game, player, commitment)             // sealed phase 1
fn reveal(game, player, preimage)               // sealed/checkpoint reveal; checks Poseidon
fn claim_timeout(game)                           // liveness: punish a non-moving player
fn state(game) -> GameState                      // view
```

### 8.4 Verifier integration
Use the Soroban **UltraHonk verifier** (Noir path). Each module's circuit has a fixed verification key registered at deploy time; `submit_move` selects the VK by move type and calls the verifier host/contract with `(vk, public_inputs, proof)`. Poseidon commitment checks use the **native Poseidon host function** (cheap). BN254 host functions (Protocol 25/26) back the pairing/MSM work.

**Cost note:** UltraHonk proofs are larger/costlier to verify than Groth16 (Circom). We accept this for Noir's DX. Protocol 26's BN254 host functions materially reduce the cost. If a specific hot circuit proves too expensive on-chain, the fallback is to port *that one circuit* to Circom/Groth16 behind the same module API (the SDK abstracts the proof system). Do not prematurely optimize.

---

## 9. The engine (generic, in `@zktable/core`)

- **State/turn engine:** owns turn order, phases, legal-move enumeration, reveal checkpoints, and win detection — all driven by the `defineGame` object, game-agnostic.
- **Dual reducer:** the move `apply` functions are authored once in TS. For on-chain authority, the same move table is mirrored in Rust. **Consistency strategy:** author reducers in a restricted, serializable form (a small pure-function subset) and generate/verify the Rust mirror against the TS reference with a shared **golden test vector suite** (identical input state + move → identical output state hash). Any divergence is a build failure. Start by hand-writing both and locking them with golden vectors; codegen is a later optimization.
- **Proof orchestration:** given a move + player view, the engine builds the witness, invokes the right circuit's prover (Noir + Barretenberg `bb.js` in the browser, or a prover service if too slow), assembles the tx, and submits to the contract. The developer never touches this.
- **Client prediction:** the engine runs `apply` optimistically for snappy UI, then reconciles with on-chain events.

---

## 10. AI agent harness (`@zktable/agents`)

### 10.1 The interface
```ts
interface Agent {
  // Called each time it's this agent's turn. Returns a chosen legal move.
  act(view: PlayerView, legalMoves: Move[]): Promise<Move>
  // Optional: react to public events (other players' moves, reveals).
  observe?(event: GameEvent): void
}
```

### 10.2 The anti-cheat invariant (the killer property)
`PlayerView` contains **only** public state + *this agent's own secret*. It is constructed by the engine from the same data a human client sees. Agents therefore **cannot** access opponents' secrets, and every move they make is proven legal on-chain exactly like a human's. **An AI opponent is mathematically incapable of cheating.** This is the headline demo line — show it explicitly in the UI ("the AI only sees what you'd let a person see, and its move was ZK-verified").

### 10.3 Shipped policies
- **`HeuristicAgent`** — per-game rule-based baseline; deterministic (great for tests, offline play, CI). Each example game provides one.
- **`ClaudeAgent`** — serializes `view + legalMoves` into a prompt; the model returns a chosen move (+ optional bluff/reasoning) via **structured output / tool use**. Use the Anthropic SDK. Default model: a current capable Claude model — **verify exact model IDs, params, and pricing via the `claude-api` skill before wiring this up** (do not hardcode from memory). Use a fast model in-game for latency and a stronger model for hard lookahead if needed. Keep all keys server-side (a thin API route), never in the browser.

### 10.4 Asymmetric play
The harness supports role-asymmetric games (e.g. one AI Phantom vs several AI/human Investigators). Any seat — human or agent — is interchangeable.

---

## 11. Data & type reference (shared vocabulary)

```ts
type PlayerId = string
type Move = { type: string; [k: string]: unknown }
type Outcome = { winner: PlayerId | PlayerId[] | 'draw' }
type Commitment = Uint8Array            // Poseidon output
type PlayerView = {
  public: PublicState
  self: { id: PlayerId; role?: string; secret: SecretState }  // ONLY own secret
  tickets?: Record<string, number>
  legalMoves: Move[]
}
type Proof = { publicInputs: Field[]; bytes: Uint8Array; circuit: CircuitId }
```

---

## 12. Flagship example game — "Blackout" (Scotland-Yard-style)

**Theme (original, trademark-safe):** a noir manhunt. A hidden fugitive, **the Phantom**, moves secretly across a city transit map; a team of **Investigators** hunts them down. Same mechanics as Scotland Yard, original name/art. (Mechanics aren't copyrightable; the *name* "Scotland Yard" and its art are Ravensburger's — do not use them.)

### 12.1 Ruleset (v1)
- **Players:** 1 Phantom + 3 Investigators (support up to 5 investigators).
- **Map:** a transit graph of numbered nodes connected by three transport types — **taxi**, **bus**, **rail** (analogous to taxi/bus/underground). Ship one well-designed map as JSON (start with a ~60–120 node custom map for clarity/perf; the classic 199-node London topology is a stretch goal). Map data is public; compiled to the `board` edge-Merkle root.
- **Tickets:** each move spends a ticket of the transport used; counts are limited and public. The Phantom's *ticket type is announced publicly each turn* (this is the core clue) but its *destination stays hidden*.
- **Turn order:** Phantom moves, then each Investigator.
- **Reveal turns:** the Phantom surfaces (reveals exact position) on rounds **3, 8, 13, 18, 24**.
- **Win:** Investigators win by moving onto the Phantom's exact node (verified at their move or at a reveal). Phantom wins by surviving **24** rounds.

### 12.2 How it maps to the SDK
- `board.graph(cityMap)` → edge-Merkle root `G`.
- Phantom `pos` = `zk.hidden.node()`; Investigators `pos` = `zk.public.node()`.
- Phantom move → `zk.board.moveAlong('map', { announce: 'ticket', prove: 'legal-edge' })` → `move_along` circuit (§7.1).
- Reveal checkpoints → `reveal.when` + contract Poseidon check.
- Tickets → `zk.resource`; enforced on-chain.
- Investigator moves are public (no proof needed) — the engine handles mixed public/private moves in one game.

### 12.3 Why it's the flagship
Hidden *movement* (not static hidden state) is novel vs. the prior hackathon; the "AI Phantom literally cannot teleport" story is the strongest possible ZK-trust demo; and the map UX (pawns, ticket feed, shrinking "possible-locations shadow") is the most visually compelling board to build.

---

## 13. Other arcade examples (breadth proof)

- **Liar's Dice** — `dice.rollHidden(5)` + `sealed` bids; AI bluffing showcase; proves the `dice` module. (Medium effort.)
- **Coup-lite** — `deck.of(...)` + `sealed` claims/challenges; proves the `deck` module. (Higher effort; depends on §7.2 deck module; sequence last.)

Each example is a single small game-definition file + a board component. They exist to prove the SDK is general, and to populate the arcade lobby.

---

## 14. Web app & UX (`@zktable/web`)

**Stack:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Wallet: **Freighter** (Stellar) via `@stellar/stellar-sdk` + Soroban RPC on **testnet**. Proof generation client-side via `bb.js` WASM (fallback: a prover API route if a circuit is too heavy for the browser).

### 14.1 Screens / flows
1. **Landing** — the pitch, "the AI can't cheat," a live demo CTA. Sets the tone; this is also the judge's first impression, so invest in it.
2. **Arcade lobby** — cards for each game (Blackout, Liar's Dice, Coup-lite); "Play vs AI" and "Create/Join match."
3. **Wallet connect** — Freighter; testnet; friendly errors; fund-from-friendbot helper.
4. **Game room** — the board (per game), turn indicator, ticket/resource HUD, event log, "what's provably hidden" affordance, and a subtle **proof status** indicator (proving… → verified on-chain ✓) so the ZK is *visible*, not invisible.
5. **Blackout board specifically** — the transit map, investigator pawns, Phantom's announced-ticket feed, the **possible-locations shadow** (client-side inference over the public graph + announced tickets, shrinking each reveal), reveal-turn spotlight animation.
6. **Post-game** — outcome, a shareable recap, and a "verify on-chain" link to the contract state.

### 14.2 UX principles (this is a graded differentiator)
- **Make the ZK legible.** Every proof step gets a small, satisfying "verified on-chain" moment. The magic must be *felt*.
- **Asymmetric clarity.** As Investigator, foreground the deduction (shadow map). As Phantom, foreground evasion (your hidden trail, safe exits).
- **Snappy.** Optimistic UI via the engine's client reducer; reconcile on events. Never block the board on a network round-trip.
- **Honest states.** Clear "proving…", "waiting for opponent", "your turn", and failure states. If mock data is used anywhere in a demo, label it.
- Follow the `impeccable` / `ui-ux-pro-max` design skills when building the frontend.

---

## 15. Tech stack & external dependencies

| Concern | Choice | Notes / source |
|---|---|---|
| ZK language | **Noir** | Rust-like, readable; we ship the circuits. https://noir-lang.org/docs/ |
| Proof system | UltraHonk (Barretenberg) | `bb` / `bb.js` for proving; browser-capable |
| On-chain verifier | Soroban UltraHonk verifier | https://github.com/yugocabrio/rs-soroban-ultrahonk |
| Smart contracts | **Soroban (Rust)** | Stellar testnet; Protocol 25/26 host functions |
| Hashing / commitments | **Poseidon/Poseidon2** | native host function (Protocol 25) — cheap on-chain |
| Curve ops | BN254 (+ BLS12-381) | Protocol 25/26 host functions |
| Chain SDK / wallet | `@stellar/stellar-sdk`, Freighter, Soroban RPC | testnet + Friendbot funding |
| SDK / app language | TypeScript | monorepo |
| Web | Next.js + Tailwind + shadcn/ui | |
| AI | Anthropic SDK (Claude) | **confirm model IDs/params via `claude-api` skill** |
| Monorepo | pnpm workspaces + Turborepo | |
| Testing | Vitest (TS), `nargo test` (Noir), `cargo test` + Soroban test host (contracts), Playwright (e2e) | |

**Fallback lever:** the SDK abstracts the proof system behind each module API, so an individual hot circuit can be swapped Noir→Circom/Groth16 (cheaper verify: https://github.com/stellar/soroban-examples/tree/main/groth16_verifier) without changing game code. Don't do this preemptively.

---

## 16. Repository layout

```
zktable/
├── PRD.md                      # this document
├── package.json                # pnpm workspace root
├── turbo.json
├── packages/
│   ├── core/                   # @zktable/core — SDK: defineGame, engine, orchestration
│   ├── circuits/               # @zktable/circuits — Noir circuits + witness builders
│   │   └── src/{board,dice,deck,hidden,sealed}/
│   ├── contracts/              # @zktable/contracts — Soroban referee + verifier glue (Rust)
│   ├── agents/                 # @zktable/agents — Agent, HeuristicAgent, ClaudeAgent
│   └── web/                    # @zktable/web — Next.js arcade app
├── games/
│   ├── blackout/               # flagship (Scotland-Yard-style)
│   ├── liars-dice/
│   └── coup-lite/
└── docs/                       # generated API docs, ADRs, demo script
```

---

## 17. Security & trust model

- **What ZK guarantees:** hidden state stays hidden; every secret-dependent move is provably legal; nobody (not even the app host) can fabricate an illegal move or a false reveal.
- **Trusted:** the correctness of the published circuits + verification keys (audit/lock these), the Soroban runtime, and the map/deck root committed at game creation.
- **Not trusted:** any server, the opponent, or the AI. There is no "god-mode" server that sees all secrets — a specific failure mode the prior hackathon called out.
- **Threats to handle:** (a) **grinding randomness** → commit-reveal seed (§7.3); (b) **stale-state / replay** → bind proofs to the current commitment + round/nonce in public inputs; (c) **liveness / griefing** (a player who won't move or reveal) → `claim_timeout` forfeits; (d) **shuffle collusion** → documented `deck` v1 limitation (§7.2); (e) **front-running reveals** → the `sealed` commit gate + phase state.
- **Keys:** wallet keys stay in Freighter; Anthropic keys stay server-side.

---

## 18. Build order (phased, with acceptance criteria)

Start at M0. Each milestone is independently demoable. **Vertical-slice first:** get one real proof verified on-chain before breadth.

**M0 — Scaffold & prove the pipeline works (spike).**
Set up pnpm+Turbo monorepo; install Noir toolchain + Soroban CLI; clone the UltraHonk verifier. Write the *simplest possible* Noir circuit (prove knowledge of a Poseidon preimage), generate a proof with `bb.js`, and **verify it inside a deployed Soroban contract on testnet.**
✅ *Done when:* a test submits a proof to a live testnet contract and gets `true`; a wrong proof gets `false`. This de-risks the entire project.

**M1 — `@zktable/core` engine skeleton.**
Implement `defineGame`, the state/turn engine, legal-move enumeration, `PlayerView` construction, and the TS reducer runner. No ZK yet; a fully public tic-tac-toe runs end-to-end in memory.
✅ *Done when:* a public game plays to completion via the engine, with unit tests.

**M2 — `board` module + `move_along` circuit.**
Build the edge-Merkle graph encoding, the `move_along` Noir circuit, witness builder, and the generic Soroban referee's `submit_move` verifying it. Wire commitments + reveal checkpoints.
✅ *Done when:* a scripted Phantom makes a hidden move, the proof verifies on testnet, an illegal edge is rejected, and a reveal turn checks out.

**M3 — Flagship "Blackout" playable (headless).**
Ship the `blackout` game definition, a city map JSON, tickets, reveal rounds, win detection. Play Phantom-vs-Investigators fully via the engine + on-chain contract, no UI.
✅ *Done when:* a full 24-round game runs to a real outcome on testnet, all Phantom moves ZK-verified.

**M4 — Web app + Blackout board UX.**
Next.js arcade shell, Freighter connect, the Blackout board with pawns, ticket feed, possible-locations shadow, proof-status indicator, reveal animation. Human plays Investigators.
✅ *Done when:* a human plays a full Blackout match in the browser against scripted opponents, seeing proofs verify live.

**M5 — AI agents.**
`Agent` interface + `HeuristicAgent` for Blackout + `ClaudeAgent` (server-side route). Human vs AI Phantom and vs AI Investigators.
✅ *Done when:* a human completes a match against AI on each side; the "AI can't cheat" affordance is shown; heuristic agent is deterministic in tests.

**M6 — Arcade breadth: `dice` + Liar's Dice, then `deck` + Coup-lite.**
Implement `dice` module + `dice_valid` circuit → Liar's Dice (+ its board UI + heuristic/Claude agent). Then the `deck` module (§7.2, honest simplification) → Coup-lite.
✅ *Done when:* all three games are playable vs AI from the lobby; each exercises its module with on-chain verification.

**M7 — Polish, docs, demo.**
Landing page, "verify on-chain" links, ADRs, a "build your own game in <200 lines" tutorial, the 2–3 min demo video script, and a README that is honest about limitations (deck v1, map size, any mocks).
✅ *Done when:* a stranger can clone, run, play, and understand what ZK is doing; demo video recorded.

---

## 19. Open questions / decisions log

- **[DECIDED] Noir over Circom** for DX; proof-system abstracted per module so a hot circuit can be ported later if verify cost bites.
- **[DECIDED] Compose-don't-compile.** Fixed 5-primitive vocabulary; Noir escape hatch is post-v1.
- **[DECIDED] Flagship = Blackout** (Scotland-Yard mechanics, original theme).
- **[DECIDED] AI = Claude agent + heuristic baseline**, both behind one interface, both cheat-proof by construction.
- **[OPEN] Map size for v1** — custom ~60–120 nodes first; classic 199-node topology is a stretch goal (perf of proving + shadow inference).
- **[OPEN] Browser proving vs prover service** — default to `bb.js` in-browser; add a service only if a circuit is too heavy (measure in M2).
- **[OPEN] Dual-reducer strategy** — hand-write TS+Rust locked by golden vectors first; codegen later if it pays off.
- **[OPEN] Exact Claude model/params** — resolve via the `claude-api` skill at M5.
- **[OPEN] Deck v1 security ceiling** — semi-honest shuffle seed; decide whether to invest toward coSNARK-grade before shipping Coup-lite.

---

## 20. Glossary & references

### Glossary
- **ZK / zero-knowledge proof** — prove a statement is true while revealing nothing beyond its truth.
- **Commitment** — a hiding, binding fingerprint of a value (`Poseidon(value, salt)`); reveal later by showing the preimage.
- **Commit-reveal** — commit a hidden value now, reveal it later; prevents changing it after the fact and prevents acting on others' hidden values early.
- **Poseidon** — a ZK-friendly hash; a Stellar host function → cheap to check on-chain.
- **BN254 / BLS12-381** — elliptic curves whose operations (via host functions) back proof verification.
- **Noir** — a Rust-like DSL for writing ZK circuits; produces UltraHonk proofs.
- **UltraHonk / Barretenberg (`bb`)** — the proving system/toolchain behind Noir.
- **Groth16 / Circom** — an alternative, cheaper-to-verify but lower-level circuit stack (our fallback).
- **Soroban** — Stellar's smart-contract platform (Rust).
- **Witness** — the private inputs to a circuit.
- **Verification key (VK)** — public data letting anyone check proofs for a given circuit.

### References
- Stellar Real-World ZK hackathon primer (Protocol 25/26 context).
- Noir docs — https://noir-lang.org/docs/
- Noir Soroban verifier (UltraHonk) — https://github.com/yugocabrio/rs-soroban-ultrahonk
- Noir on Stellar tutorial — https://jamesbachini.com/noir-on-stellar/
- Circom docs — https://docs.circom.io/
- Groth16 verifier (fallback) — https://github.com/stellar/soroban-examples/tree/main/groth16_verifier
- Circom on Stellar tutorial — https://jamesbachini.com/circom-on-stellar/
- RISC Zero (alt proving path, not used) — https://dev.risczero.com/ · verifier https://github.com/NethermindEth/stellar-risc0-verifier/ · tutorial https://jamesbachini.com/stellar-risc-zero-games/
- Prior hackathon field (competitive intel) — DoraHacks "Stellar Hacks: ZK Gaming".
- `claude-api` skill — for Claude model IDs, params, pricing (use at M5).

---

*End of PRD. Begin at Section 18, Milestone M0.*
