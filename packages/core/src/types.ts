// Core data & game-model types for @zktable/core.
//
// These interfaces are load-bearing: every later milestone (ZK modules,
// concrete games, the web app, AI agents) is built against them. See
// PRD.md §5 (SDK game model), §9 (engine), §11 (data types) for rationale.

/** A player is identified by an opaque, stable string (wallet address, seat id, ...). */
export type PlayerId = string

/** A game-defined role label (e.g. "phantom", "investigator"). Opaque string. */
export type Role = string

/** A move a player submits. `type` discriminates the move kind; the rest is move-specific payload. */
export type Move = { type: string } & Record<string, unknown>

/** Terminal result of a match. */
export type Outcome = { winner: PlayerId | PlayerId[] | 'draw' }

/** Public game state — visible to every player (and, on-chain, the contract). */
export type PublicState = Record<string, unknown>

/** Per-player secret state — never leaves that player's view. */
export type SecretState = Record<string, unknown>

/**
 * What a single player is allowed to see: public state, their own secret
 * state (never another player's), their own resources, and their currently
 * legal moves.
 */
export type PlayerView = {
  public: PublicState
  self: { id: PlayerId; role?: Role; secret: SecretState } // ONLY own secret
  tickets?: Record<string, number> // own resources
  legalMoves: Move[]
}

/**
 * Authoritative state the engine/contract track. Contains NO secrets — only
 * public state + commitments. (On-chain the reducer sees exactly this.)
 */
export type MatchState = {
  status: 'lobby' | 'active' | 'finished'
  players: Array<{ id: PlayerId; role?: Role; resources: Record<string, number> }>
  turn: { current: PlayerId; phase: number; round: number; order: PlayerId[] }
  public: PublicState
  commitments: Record<string, string> // path -> commitment (empty until M2)
  outcome: Outcome | null
}

/** Context passed into a move's `apply` reducer. */
export type MoveContext = {
  playerId: PlayerId
  players: MatchState['players']
  config: Record<string, unknown>
}

/**
 * The definition of a single move type: how to enumerate it as legal, and
 * how to apply it deterministically. `zkp` is a marker for the ZK module
 * that will secure this move on-chain (M2+); M1 ignores it entirely.
 */
export type MoveSpec = {
  zkp?: unknown // ZK binding marker; ignored in M1
  legal: (view: PlayerView) => Move[] // enumerate legal moves for this player
  apply: (state: MatchState, move: Move, ctx: MoveContext) => MatchState // PURE, deterministic
}

/**
 * How turn order is resolved from the roster:
 * - 'clockwise': seat order as given in the roster, cycling.
 * - 'roles': all players of players.roles[0], then roles[1], ... cycling.
 * - function: caller-supplied total order over the roster.
 */
export type TurnOrder =
  | 'clockwise'
  | 'roles'
  | ((players: MatchState['players']) => PlayerId[])

/** The declarative shape a game author writes; input to `defineGame`. */
export type GameDefinition = {
  name: string
  players: { min: number; max: number; roles?: Role[] }
  components?: Record<string, unknown> // zk.* component markers; opaque in M1
  state: {
    public: (ctx: SetupContext) => PublicState
    secret?: (ctx: SetupContext & { role?: Role; id: PlayerId }) => SecretState
  }
  setup?: (state: MatchState, ctx: SetupContext) => MatchState // optional post-init hook
  turn: {
    order: TurnOrder
    phases?: string[]
    moves: Record<string, MoveSpec>
  }
  reveal?: { when: (state: MatchState) => boolean; what: string[] }
  end: (state: MatchState) => Outcome | null
}

/** Context available while building initial public/secret state. */
export type SetupContext = {
  players: Array<{ id: PlayerId; role?: Role }>
  config: Record<string, unknown>
}

/** The compiled, validated output of `defineGame`. */
export type Game = { def: GameDefinition }
