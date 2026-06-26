import { deepEqual } from './deep-equal.js'
import type {
  Game,
  MatchState,
  Move,
  MoveContext,
  MoveSpec,
  PlayerId,
  PlayerView,
  Role,
  SecretState,
  SetupContext,
} from './types.js'

export type MatchOptions = {
  config?: Record<string, unknown>
  /** Deterministic seed for any randomness a game/component needs. Never `Date.now()`/`Math.random()`. */
  seed?: string
}

type RosterEntry = { id: PlayerId; role?: Role }

/**
 * A running match: owns turn order, legal-move enumeration, reveal
 * checkpoints, and win detection, all driven by a `Game`'s definition.
 *
 * Secrets are held privately on the instance (never on `state`), so
 * `match.state` is always safe to serialize/share as-is.
 */
export class Match {
  readonly game: Game
  state: MatchState

  private readonly rosterIds: Set<PlayerId>
  private readonly secrets: Map<PlayerId, SecretState>
  private readonly config: Record<string, unknown>

  constructor(game: Game, roster: RosterEntry[], opts: MatchOptions = {}) {
    validateRoster(game, roster)

    this.game = game
    this.rosterIds = new Set(roster.map((p) => p.id))
    this.config = { ...(opts.config ?? {}), ...(opts.seed !== undefined ? { seed: opts.seed } : {}) }

    const setupCtx: SetupContext = { players: roster, config: this.config }
    const order = resolveTurnOrder(game.def.turn.order, roster, game.def.players.roles)

    this.secrets = new Map(
      roster.map((p) => [
        p.id,
        game.def.state.secret?.({ ...setupCtx, role: p.role, id: p.id }) ?? {},
      ]),
    )

    let state: MatchState = {
      status: 'active',
      players: roster.map((p) => ({ id: p.id, role: p.role, resources: {} })),
      turn: { current: order[0]!, phase: 0, round: 0, order },
      public: game.def.state.public(setupCtx),
      commitments: {},
      outcome: null,
    }

    if (game.def.setup) {
      state = game.def.setup(state, setupCtx)
    }

    this.state = state
  }

  /** This player's view: public state, their own secret only, their resources, their legal moves. */
  view(playerId: PlayerId): PlayerView {
    this.assertKnownPlayer(playerId)
    const player = this.state.players.find((p) => p.id === playerId)!
    return {
      public: this.state.public,
      self: { id: player.id, role: player.role, secret: this.secrets.get(playerId) ?? {} },
      tickets: player.resources,
      legalMoves: this.legalMoves(playerId),
    }
  }

  /** Union of every move spec's `legal(view)` for this player; empty unless it is their turn. */
  legalMoves(playerId: PlayerId): Move[] {
    this.assertKnownPlayer(playerId)
    if (this.state.status !== 'active' || this.state.turn.current !== playerId) {
      return []
    }
    const view = this.viewWithoutLegalMoves(playerId)
    const moves: Move[] = []
    for (const spec of Object.values(this.game.def.turn.moves)) {
      moves.push(...spec.legal(view))
    }
    return moves
  }

  /**
   * Validate, apply, and settle a move: legality check -> pure `apply` ->
   * reveal checkpoint -> turn advance -> end check. Returns the new
   * `MatchState` (a superset of the brief's `void` signature — safe for
   * callers that ignore the return value).
   */
  submit(playerId: PlayerId, move: Move): MatchState {
    this.assertKnownPlayer(playerId)

    if (this.state.status === 'finished') {
      throw new Error('Match.submit: match is already finished')
    }
    if (this.state.turn.current !== playerId) {
      throw new Error(`Match.submit: it is not "${playerId}"'s turn`)
    }

    const { spec, legal } = this.findMatchingMoveSpec(playerId, move)
    if (!spec) {
      throw new Error(
        `Match.submit: move ${JSON.stringify(move)} is not among "${playerId}"'s legal moves (${JSON.stringify(legal)})`,
      )
    }

    const ctx: MoveContext = { playerId, players: this.state.players, config: this.config }
    let nextState = spec.apply(this.state, move, ctx)

    nextState = applyRevealCheckpoint(nextState, this.game.def.reveal)
    nextState = advanceTurn(nextState)

    const outcome = this.game.def.end(nextState)
    if (outcome !== null) {
      nextState = { ...nextState, status: 'finished', outcome }
    }

    this.state = nextState
    return this.state
  }

  private findMatchingMoveSpec(
    playerId: PlayerId,
    move: Move,
  ): { spec: MoveSpec | null; legal: Move[] } {
    const view = this.viewWithoutLegalMoves(playerId)
    const allLegal: Move[] = []
    for (const spec of Object.values(this.game.def.turn.moves)) {
      const legal = spec.legal(view)
      allLegal.push(...legal)
      if (legal.some((candidate) => deepEqual(candidate, move))) {
        return { spec, legal: allLegal }
      }
    }
    return { spec: null, legal: allLegal }
  }

  private viewWithoutLegalMoves(playerId: PlayerId): PlayerView {
    const player = this.state.players.find((p) => p.id === playerId)!
    return {
      public: this.state.public,
      self: { id: player.id, role: player.role, secret: this.secrets.get(playerId) ?? {} },
      tickets: player.resources,
      legalMoves: [],
    }
  }

  private assertKnownPlayer(playerId: PlayerId): void {
    if (!this.rosterIds.has(playerId)) {
      throw new Error(`Match: unknown player "${playerId}"`)
    }
  }
}

export function createMatch(
  game: Game,
  roster: RosterEntry[],
  opts?: MatchOptions,
): Match {
  return new Match(game, roster, opts)
}

// --- internals ---------------------------------------------------------

function validateRoster(game: Game, roster: RosterEntry[]): void {
  const { players } = game.def
  if (roster.length < players.min || roster.length > players.max) {
    throw new Error(
      `createMatch: roster size ${roster.length} is outside players range [${players.min}, ${players.max}]`,
    )
  }
  if (players.roles && players.roles.length > 0) {
    for (const p of roster) {
      if (!p.role || !players.roles.includes(p.role)) {
        throw new Error(
          `createMatch: player "${p.id}" has role "${p.role ?? ''}", which is not one of the declared roles [${players.roles.join(', ')}]`,
        )
      }
    }
  }
}

function resolveTurnOrder(
  order: Game['def']['turn']['order'],
  roster: RosterEntry[],
  declaredRoles: Role[] | undefined,
): PlayerId[] {
  if (order === 'clockwise') {
    return roster.map((p) => p.id)
  }
  if (order === 'roles') {
    const roles = declaredRoles ?? []
    const result: PlayerId[] = []
    for (const role of roles) {
      for (const p of roster) {
        if (p.role === role) result.push(p.id)
      }
    }
    return result
  }
  return order(roster.map((p) => ({ id: p.id, role: p.role, resources: {} })))
}

/**
 * SEAM for M2: today this is a no-crypto marker — once `reveal.when(state)`
 * flips true, it appends `{ round, what }` to `public.reveals`. M2 replaces
 * the marker with an actual on-chain Poseidon-preimage reveal (player
 * submits `(value, salt)`, contract checks `Poseidon(value,salt) == C` and
 * publishes `value`); the *trigger* condition (`reveal.when`) and the
 * *target paths* (`reveal.what`) are already fully expressed here and do
 * not need to change.
 */
function applyRevealCheckpoint(
  state: MatchState,
  reveal: Game['def']['reveal'],
): MatchState {
  if (!reveal || !reveal.when(state)) return state
  const reveals = [
    ...((state.public.reveals as Array<{ round: number; what: string[] }>) ?? []),
    { round: state.turn.round, what: reveal.what },
  ]
  return { ...state, public: { ...state.public, reveals } }
}

function advanceTurn(state: MatchState): MatchState {
  const { order, current, round, phase } = state.turn
  const currentIndex = order.indexOf(current)
  const nextIndex = (currentIndex + 1) % order.length
  const wrapped = nextIndex === 0
  return {
    ...state,
    turn: {
      order,
      phase,
      current: order[nextIndex]!,
      round: wrapped ? round + 1 : round,
    },
  }
}
