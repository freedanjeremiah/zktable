// Liar's Dice — the zkTable `dice` + `sealed` showcase (PRD §5.3 EXAMPLE 2):
// each player's roll is a hidden, ZK-proven-fair `dice_valid` roll (M6.1);
// players escalate public bids about the combined roll; a challenge opens a
// reveal and resolves who was bluffing. Mirrors Blackout's shape
// (`games/blackout/src/blackout.ts`) as the SDK's second G1 showcase.
//
// Design note on secrecy in the LOCAL engine (no chain involved), matching
// Blackout's own note in spirit: `apply` reducers are pure over public
// `MatchState` and never see secret state (per `@zktable/core`'s engine —
// see `Match.submit`), so a local, chain-free `challenge` resolution needs
// SOME way to compare both players' dice. Rather than invent a
// secrets-visible-to-apply escape hatch, this game computes each player's
// roll ONCE at match-construction time (`state.secret` below) from
// `MatchOptions.config.liarsDice.diceByPlayer` (the REAL seed-derived roll,
// supplied by `runner.ts` for the on-chain path) — or, if omitted, a
// deterministic seeded fallback for chain-free local tests — and mirrors the
// SAME values into `public.diceByPlayer` so the pure `apply` reducer can
// resolve a challenge. This is exactly Blackout's own precedent: `state.
// secret` there returns REAL data (the Phantom's actual start position), not
// an inert `zk.hidden.node()` marker; `zk.*` markers stay confined to
// `components` and a move's `zkp` binding field, per that file's own
// comment. `public.diceByPlayer` being technically readable mid-game is a
// local-mirror simplification only — the REAL hiding is enforced on-chain by
// the `dice_valid` proof + the sealed commit-reveal seed (see
// `packages/contracts/contracts/liars-dice-referee`), which never reveals a
// die value before its player opens it at `reveal_dice`.

import { defineGame, zk } from '@zktable/core'
import type { Move, MoveContext, Outcome, PlayerId, PlayerView, MatchState, PublicState, SetupContext } from '@zktable/core'

export const SIDES = 6
export const DICE_PER_PLAYER = 5
/** The player range the local engine supports (M8.2 multi-round elimination). */
export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 6
/** Default seat count for the demos/runner. The ON-CHAIN referee's v1 scope is exactly 2. */
export const N_PLAYERS = 2

export type BidEntry = { player: PlayerId; quantity: number; face: number }

/** Per-match config, passed as `MatchOptions.config.liarsDice`. */
export type LiarsDiceConfig = {
  /**
   * The REAL rolled dice per player (round 1 only — later rounds, which
   * exist only in local multi-round play, re-roll deterministically from
   * the match seed). Required for the on-chain runner (the ZK-proven,
   * seed-derived roll); if omitted, `setup` derives a deterministic seeded
   * roll from `MatchOptions.seed` so pure local tests don't need a prover.
   */
  diceByPlayer?: Record<PlayerId, number[]>
  /**
   * What a lost challenge costs (M8.2):
   * - 'die' (default): the loser loses ONE die; alive players re-roll and a
   *   new round begins; a player at 0 dice is eliminated (the engine skips
   *   their turns via `turn.eliminated`); last player with dice wins.
   * - 'seat': the loser loses ALL dice at once — the exact single-round
   *   semantics of the v1 on-chain referee (`runner.ts` passes this so the
   *   local mirror stays in lockstep with the chain).
   */
  lossMode?: 'die' | 'seat'
}

function readConfig(raw: Record<string, unknown>): LiarsDiceConfig {
  return (raw.liarsDice as LiarsDiceConfig | undefined) ?? {}
}

// --- deterministic fallback dice (no chain, no prover) ----------------------

function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministic (seeded) roll of `n` dice, used only when no real proven roll is supplied. */
export function seededRoll(seed: string, n: number, sides: number = SIDES): number[] {
  const rnd = mulberry32(hashSeed(seed))
  return Array.from({ length: n }, () => Math.floor(rnd() * sides) + 1)
}

function currentBid(view: PlayerView): BidEntry | null {
  return (view.public.currentBid as BidEntry | null) ?? null
}

function totalDice(view: PlayerView): number {
  const diceByPlayer = (view.public.diceByPlayer as Record<PlayerId, number[]>) ?? {}
  return Object.values(diceByPlayer).reduce((sum, dice) => sum + dice.length, 0)
}

/** Every strictly-escalating `(quantity, face)` bid above the current one. */
function bidsAbove(view: PlayerView): Move[] {
  const cur = currentBid(view)
  const maxQuantity = Math.max(totalDice(view), 1)
  const moves: Move[] = []
  for (let quantity = 1; quantity <= maxQuantity; quantity++) {
    for (let face = 1; face <= SIDES; face++) {
      const escalates = !cur || quantity > cur.quantity || (quantity === cur.quantity && face > cur.face)
      if (escalates) moves.push({ type: 'bid', quantity, face })
    }
  }
  return moves
}

export const liarsDice = defineGame({
  name: 'liars-dice',
  players: { min: MIN_PLAYERS, max: MAX_PLAYERS },

  components: {
    // Public dice-pool declaration; the actual roll is hidden per player.
    dice: zk.dice.pool({ sides: SIDES }),
  },

  state: {
    public: (): PublicState => ({
      // See the module doc: local-mirror-only visibility, not real hiding.
      // Holds the CURRENT round's rolls for players still in the game.
      diceByPlayer: {} as Record<PlayerId, number[]>,
      // Dice remaining per player; 0 == eliminated (engine skips their turn).
      diceCountByPlayer: {} as Record<PlayerId, number>,
      roundNumber: 1,
      bidHistory: [] as BidEntry[],
      currentBid: null as BidEntry | null,
      eliminatedIds: [] as PlayerId[],
      winnerId: null as PlayerId | null,
      resolvedCount: null as number | null,
    }),
    // Real data (matches Blackout's `state.secret`, not an inert `zk.*`
    // marker — see the module doc): this player's roll, either the REAL
    // `dice_valid`-proven roll (`config.liarsDice.diceByPlayer`, supplied by
    // the on-chain runner) or a deterministic seeded fallback for chain-free
    // local play. Computed with the exact same formula `setup` below uses
    // for `public.diceByPlayer`, so the two always agree.
    secret: (ctx) => {
      const cfg = readConfig(ctx.config)
      const seed = (ctx.config.seed as string | undefined) ?? 'liars-dice-default-seed'
      const dice = cfg.diceByPlayer?.[ctx.id] ?? seededRoll(`${seed}:${ctx.id}`, DICE_PER_PLAYER)
      return { dice }
    },
  },

  setup: (state: MatchState, ctx: SetupContext): MatchState => {
    const cfg = readConfig(ctx.config)
    const seed = (ctx.config.seed as string | undefined) ?? 'liars-dice-default-seed'
    const diceByPlayer: Record<PlayerId, number[]> = {}
    const diceCountByPlayer: Record<PlayerId, number> = {}
    for (const p of ctx.players) {
      diceByPlayer[p.id] = cfg.diceByPlayer?.[p.id] ?? seededRoll(`${seed}:${p.id}`, DICE_PER_PLAYER)
      diceCountByPlayer[p.id] = diceByPlayer[p.id]!.length
    }
    return { ...state, public: { ...state.public, diceByPlayer, diceCountByPlayer } }
  },

  turn: {
    order: 'clockwise',
    // A player with no dice left is out: the engine skips their turn and
    // returns no legal moves for them (M8.2 turn-skip hook).
    eliminated: (state: MatchState, playerId: PlayerId): boolean =>
      ((state.public.diceCountByPlayer as Record<PlayerId, number>)[playerId] ?? DICE_PER_PLAYER) === 0,
    moves: {
      bid: {
        // Plain public escalation — no ZK binding (the hidden randomness is
        // the dice roll itself, proven at roll time; bidding is open info).
        legal: bidsAbove,
        apply: (state: MatchState, move: Move, ctx: MoveContext): MatchState => {
          const entry: BidEntry = {
            player: ctx.playerId,
            quantity: move.quantity as number,
            face: move.face as number,
          }
          return {
            ...state,
            public: {
              ...state.public,
              currentBid: entry,
              bidHistory: [...(state.public.bidHistory as BidEntry[]), entry],
            },
          }
        },
      },

      challenge: {
        // Binds this move to "open every player's committed dice and check
        // them against their `dice_valid` commitments" once ZK-secured —
        // inert marker in the local engine, real in `runner.ts` via
        // `reveal_dice` + the referee's `resolve`.
        zkp: zk.reveal.all('dice'),

        legal: (view: PlayerView): Move[] => (currentBid(view) ? [{ type: 'challenge' }] : []),

        apply: (state: MatchState, _move: Move, ctx: MoveContext): MatchState => {
          const bid = state.public.currentBid as BidEntry
          const diceByPlayer = state.public.diceByPlayer as Record<PlayerId, number[]>
          let count = 0
          for (const dice of Object.values(diceByPlayer)) {
            count += dice.filter((d) => d === bid.face).length
          }
          const challenger = ctx.playerId
          const loser = count >= bid.quantity ? challenger : bid.player

          const cfg = readConfig(ctx.config)
          const lossMode = cfg.lossMode ?? 'die'
          const prevCounts = state.public.diceCountByPlayer as Record<PlayerId, number>
          const loserCount =
            lossMode === 'seat' ? 0 : Math.max(0, (prevCounts[loser] ?? DICE_PER_PLAYER) - 1)
          const diceCountByPlayer = { ...prevCounts, [loser]: loserCount }

          const prevEliminated = (state.public.eliminatedIds as PlayerId[]) ?? []
          const eliminatedIds = loserCount === 0 ? [...prevEliminated, loser] : prevEliminated

          const alive = ctx.players.map((p) => p.id).filter((id) => (diceCountByPlayer[id] ?? 0) > 0)
          if (alive.length <= 1) {
            return {
              ...state,
              public: {
                ...state.public,
                diceCountByPlayer,
                eliminatedIds,
                winnerId: alive[0] ?? null,
                resolvedCount: count,
              },
            }
          }

          // Multi-round: alive players re-roll (deterministically from the
          // match seed + round number) and bidding restarts.
          const seed = (ctx.config.seed as string | undefined) ?? 'liars-dice-default-seed'
          const roundNumber = (state.public.roundNumber as number) + 1
          const nextDice: Record<PlayerId, number[]> = {}
          for (const id of alive) {
            nextDice[id] = seededRoll(`${seed}:${id}:r${roundNumber}`, diceCountByPlayer[id]!)
          }
          return {
            ...state,
            public: {
              ...state.public,
              diceByPlayer: nextDice,
              diceCountByPlayer,
              roundNumber,
              eliminatedIds,
              currentBid: null,
              resolvedCount: count,
            },
          }
        },
      },
    },
  },

  end: (state: MatchState): Outcome | null => {
    const winnerId = state.public.winnerId as PlayerId | null
    return winnerId ? { winner: winnerId } : null
  },
})
