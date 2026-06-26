// Blackout — the zkTable flagship game: Scotland-Yard-style hidden pursuit.
// One Phantom moves in secret across the city graph; Investigators move in
// the open and try to corner them using only the ticket type played each
// turn plus periodic position reveals. This `defineGame` call is the
// developer-facing artifact for G1 ("declare a game declaratively"); the
// board/hidden-position/reveal *cryptography* is a separate concern (M2's
// `move_along` circuit + the on-chain referee — see `runner.ts`).
//
// Design note on secrecy in the LOCAL engine (no chain involved): `Move` is
// plain data (`{ type, to, ticket }`) passed straight into `apply`, so the
// destination node is technically visible to the reducer even for the
// Phantom's moves — `apply` simply *chooses* not to publish it, except at a
// reveal round, matching what the on-chain referee actually enforces
// cryptographically (a ZK proof binds the move without revealing `to`; a
// reveal publishes it only when `reveal()` is called). Local play is a
// faithful behavioral mirror of the real game without needing a prover.

import { defineGame, zk } from '@zktable/core'
import type { Move, MoveContext, Outcome, PlayerId, PlayerView, MatchState, PublicState, SetupContext } from '@zktable/core'
import { cityGraph, cityGraphData, ticketName } from './map.js'
import type { Neighbor } from './map.js'

export const DEFAULT_N_ROUNDS = 24
export const DEFAULT_REVEAL_ROUNDS = [3, 8, 13, 18, 24]
export const DEFAULT_TICKETS = { taxi: 24, bus: 24, rail: 24 }

export type RevealEntry = { round: number; node: number }
export type TicketCounts = { taxi: number; bus: number; rail: number }

/** Per-match config, passed as `MatchOptions.config.blackout`. */
export type BlackoutConfig = {
  startPositions: Record<PlayerId, number>
  tickets?: Record<PlayerId, TicketCounts>
  nRounds?: number
  revealRounds?: number[]
}

function readConfig(raw: Record<string, unknown>): BlackoutConfig {
  const cfg = raw.blackout as BlackoutConfig | undefined
  if (!cfg) throw new Error('blackout: MatchOptions.config.blackout is required')
  return cfg
}

function legalMovesFrom(node: number, tickets: Record<string, number> | undefined): Move[] {
  const owned = tickets ?? {}
  return cityGraph
    .neighbors(node)
    .filter((edge: Neighbor) => (owned[ticketName(edge.ticket)] ?? 0) > 0)
    .map((edge: Neighbor) => ({ type: 'move', to: edge.to, ticket: edge.ticket }))
}

export const blackout = defineGame({
  name: 'blackout',
  players: { min: 2, max: 6, roles: ['phantom', 'investigator'] },

  components: {
    // The public transit graph every move is bound to — see `move_along` /
    // `BoardGraph` in `@zktable/circuits` for the real ZK binding.
    board: zk.board.graph(cityGraphData),
    tickets: zk.resource({ taxi: 0, bus: 0, rail: 0 }),
  },

  state: {
    public: (ctx: SetupContext) => {
      const cfg = readConfig(ctx.config)
      const investigatorNodes: Record<PlayerId, number> = {}
      for (const p of ctx.players) {
        if (p.role === 'investigator') {
          investigatorNodes[p.id] = cfg.startPositions[p.id]!
        }
      }
      return {
        round: 1,
        nRounds: cfg.nRounds ?? DEFAULT_N_ROUNDS,
        revealRounds: cfg.revealRounds ?? DEFAULT_REVEAL_ROUNDS,
        ticketFeed: [] as number[],
        revealLog: [] as RevealEntry[],
        investigatorNodes,
      }
    },
    secret: (ctx) => {
      const cfg = readConfig(ctx.config)
      return ctx.role === 'phantom' ? { pos: cfg.startPositions[ctx.id]! } : {}
    },
  },

  // Give every player their configured (or default) ticket wallet, and align
  // the engine's internal round counter with the on-chain referee's
  // 1-indexed rounds so a mirrored local Match and the real contract always
  // agree on which round is which.
  setup: (state, ctx: SetupContext) => {
    const cfg = readConfig(ctx.config)
    const players = state.players.map((p) => ({
      ...p,
      resources: { ...(cfg.tickets?.[p.id] ?? DEFAULT_TICKETS) },
    }))
    return { ...state, players, turn: { ...state.turn, round: 1 } }
  },

  turn: {
    order: 'roles', // phantom first, then investigators in join order — matches the referee's `start()`.
    moves: {
      move: {
        // Binds this move to "prove legal movement along the board graph"
        // once ZK-secured — inert marker in the local engine, real in
        // `runner.ts` via `BoardProver`.
        zkp: zk.board.moveAlong('board'),

        legal: (view: PlayerView): Move[] => {
          if (view.self.role === 'phantom') {
            const pos = view.self.secret.pos as number | undefined
            return pos === undefined ? [] : legalMovesFrom(pos, view.tickets)
          }
          if (view.self.role === 'investigator') {
            const nodes = view.public.investigatorNodes as Record<PlayerId, number>
            const pos = nodes[view.self.id]
            return pos === undefined ? [] : legalMovesFrom(pos, view.tickets)
          }
          return []
        },

        apply: (state: MatchState, move: Move, ctx: MoveContext): MatchState => {
          const role = ctx.players.find((p) => p.id === ctx.playerId)?.role
          const ticket = move.ticket as number
          const to = move.to as number

          const players = state.players.map((p) => {
            if (p.id !== ctx.playerId) return p
            const key = ticketName(ticket as Neighbor['ticket'])
            const count = (p.resources[key] as number | undefined) ?? 0
            return { ...p, resources: { ...p.resources, [key]: count - 1 } }
          })

          let publicState: PublicState = {
            ...state.public,
            round: state.turn.round,
            ticketFeed: [...(state.public.ticketFeed as number[]), ticket],
          }

          if (role === 'investigator') {
            publicState = {
              ...publicState,
              investigatorNodes: { ...(state.public.investigatorNodes as Record<PlayerId, number>), [ctx.playerId]: to },
            }
          }

          const revealRounds = state.public.revealRounds as number[]
          if (role === 'phantom' && revealRounds.includes(state.turn.round)) {
            publicState = {
              ...publicState,
              revealLog: [...(state.public.revealLog as RevealEntry[]), { round: state.turn.round, node: to }],
            }
          }

          return { ...state, players, public: publicState }
        },
      },
    },
  },

  reveal: {
    // Generic engine seam (M1): marks a checkpoint once per reveal round,
    // right after the Phantom's own move (checked on the post-apply,
    // pre-turn-advance state — see engine.ts). The *actual* revealed value
    // is `apply`'s own `public.revealLog` above; this marker exists so the
    // declarative shape matches what M2+ reveal cryptography binds to.
    when: (state: MatchState) => {
      const mover = state.players.find((p) => p.id === state.turn.current)
      const revealRounds = (state.public.revealRounds as number[] | undefined) ?? DEFAULT_REVEAL_ROUNDS
      return mover?.role === 'phantom' && revealRounds.includes(state.turn.round)
    },
    what: ['phantom.pos'],
  },

  end: (state: MatchState): Outcome | null => {
    const revealLog = state.public.revealLog as RevealEntry[]
    const investigatorNodes = state.public.investigatorNodes as Record<PlayerId, number>
    const last = revealLog.at(-1)
    if (last && Object.values(investigatorNodes).includes(last.node)) {
      const winners = state.players.filter((p) => p.role === 'investigator').map((p) => p.id)
      return { winner: winners }
    }

    const nRounds = (state.public.nRounds as number | undefined) ?? DEFAULT_N_ROUNDS
    if (state.turn.round > nRounds) {
      const phantom = state.players.find((p) => p.role === 'phantom')!.id
      return { winner: phantom }
    }

    return null
  },
})
