// Coup-lite - the zkTable `deck` module showcase (PRD §5.3 EXAMPLE 3 /
// §7.2 / M6.3): each player secretly holds 2 committed character cards
// ("influence"); players make public CLAIMS to hold a character; any other
// player may CHALLENGE the standing claim; the challenged player either
// proves in ZK that the claim is true ("hold"), or is caught bluffing and
// loses influence. Mirrors Liar's Dice's shape (`games/liars-dice/src/
// liars-dice.ts`) as the SDK's third G1 showcase.
//
// HONEST SIMPLIFICATION (PRD §7.2, deck v1 — see the `card_membership`
// circuit's and the `coup-referee` contract's module docs for the full
// statement): hands are dealt by a semi-honest dealer/orchestrator, NOT a
// ZK-proven valid shuffle (`valid_shuffle` is out of scope for v1). What IS
// real and load-bearing: the `card_membership` proof genuinely proves a
// claimed character sits in a player's committed hand, in zero knowledge.
//
// Local-mirror design note (same pattern as Liar's Dice's `diceByPlayer` —
// see that file's module doc): `@zktable/core`'s `apply` reducers are pure
// over public `MatchState` and never see secret state, so resolving a
// `challenge` locally needs a way to compare the challenged player's claim
// against their real hand. Rather than invent a secrets-visible-to-apply
// escape hatch, each player's REAL dealt hand is mirrored into
// `public.handsByPlayer` at `setup` — a LOCAL-MIRROR SIMPLIFICATION only, not
// a cryptographic claim (the real hiding + the real "hold" proof are
// enforced entirely on-chain by the `card_membership` proof, which never
// reveals a hand's contents — see `coup-referee`). `strategy.ts` deliberately
// does NOT read other players' mirrored hands — only `view.self.secret.hand`
// (own hand) plus public claim/challenge history.
//
// Turn-structure deviation from the on-chain referee (documented, not a
// discrepancy in the ZK-secured guarantee): `@zktable/core`'s engine always
// advances `turn` to the strict next player after ANY move (see
// `engine.ts`'s `advanceTurn`), and only the current-turn player may submit
// a move — there is no generic "skip an eliminated player's turn" hook (the
// board referee's `advance_turn`/liars-dice's own skip-dead-players logic is
// each contract's own bespoke code, not something `@zktable/core`'s engine
// provides). The ON-CHAIN `coup-referee` is more permissive AND more
// general — it natively supports 2-4 players and skips eliminated players
// when advancing turn (proven by its native 3-player tests). This
// `defineGame`/local engine/on-chain demo instead fixes N_PLAYERS = 2 (same
// structural reason Liar's Dice's v1 fixed 2 players): with exactly 2
// players, the moment one is eliminated the match's `winnerId` is set and
// `Match` transitions to `'finished'` on that very same move, so no
// eliminated player is ever asked for a further turn. `challenge` is
// further restricted to the single player whose turn falls immediately
// after a still-standing claim by someone else (round-robin's natural "next"
// player) — a reasonable, simpler local-mirror restriction for headless AI
// play and fast tests; it does not weaken the on-chain game, which is
// authoritative for the real showcase run (`runner.ts`).

import { defineGame, zk } from '@zktable/core'
import type { Move, MoveContext, Outcome, PlayerId, PlayerView, MatchState, PublicState, SetupContext } from '@zktable/core'

/** 5 character ids, matching the `card_membership` circuit's small-int domain. */
export const CHARACTERS = [0, 1, 2, 3, 4] as const
export const CHARACTER_NAMES = ['Duke', 'Assassin', 'Captain', 'Contessa', 'Ambassador'] as const
export const HAND_SIZE = 2
export const START_INFLUENCE = 2
/**
 * This showcase's `defineGame`/local engine/on-chain demo scope: exactly 2
 * players (see the module doc's turn-structure deviation note). The
 * ON-CHAIN `coup-referee` contract itself is more general and natively
 * supports 2-4 players (proven by its native 3-player tests) — the
 * restriction here is a `defineGame`/local-engine limitation, not a
 * contract one.
 */
export const N_PLAYERS = 2

export type Hand = [number, number]
export type ClaimEntry = { player: PlayerId; character: number }

/** Per-match config, passed as `MatchOptions.config.coupLite`. */
export type CoupLiteConfig = {
  /**
   * The REAL dealt hand per player. Required for the on-chain runner (the
   * semi-honestly dealt, `card_membership`-provable hand); if omitted,
   * `setup` derives a deterministic seeded hand from `MatchOptions.seed` so
   * pure local tests don't need the prover pipeline.
   */
  handsByPlayer?: Record<PlayerId, Hand>
}

function readConfig(raw: Record<string, unknown>): CoupLiteConfig {
  return (raw.coupLite as CoupLiteConfig | undefined) ?? {}
}

// --- deterministic fallback hands (no chain, no prover) ---------------------

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

/** Deterministic (seeded) hand of 2 DISTINCT characters, used only when no real dealt hand is supplied. */
export function seededHand(seed: string): Hand {
  const rnd = mulberry32(hashSeed(seed))
  const pool = [...CHARACTERS]
  const i0 = Math.floor(rnd() * pool.length)
  const c0 = pool.splice(i0, 1)[0]!
  const i1 = Math.floor(rnd() * pool.length)
  const c1 = pool.splice(i1, 1)[0]!
  return [c0, c1]
}

function handsByPlayer(state: MatchState): Record<PlayerId, Hand> {
  return (state.public.handsByPlayer as Record<PlayerId, Hand>) ?? {}
}
function influenceByPlayer(state: MatchState): Record<PlayerId, number> {
  return (state.public.influenceByPlayer as Record<PlayerId, number>) ?? {}
}
function deadByPlayer(state: MatchState): Record<PlayerId, [boolean, boolean]> {
  return (state.public.deadByPlayer as Record<PlayerId, [boolean, boolean]>) ?? {}
}

/** Marks one not-yet-dead slot of `player`'s hand dead and decrements influence by 1. */
function loseInfluence(
  state: MatchState,
  player: PlayerId,
): { influenceByPlayer: Record<PlayerId, number>; deadByPlayer: Record<PlayerId, [boolean, boolean]> } {
  const dead = deadByPlayer(state)
  const influence = influenceByPlayer(state)
  const playerDead = dead[player] ?? [false, false]
  const slot = playerDead[0] ? 1 : 0
  const nextDead: [boolean, boolean] = slot === 0 ? [true, playerDead[1]] : [playerDead[0], true]
  return {
    influenceByPlayer: { ...influence, [player]: Math.max(0, (influence[player] ?? START_INFLUENCE) - 1) },
    deadByPlayer: { ...dead, [player]: nextDead },
  }
}

function alivePlayers(state: MatchState): PlayerId[] {
  const influence = influenceByPlayer(state)
  return state.players.map((p) => p.id).filter((id) => (influence[id] ?? START_INFLUENCE) > 0)
}

export const coupLite = defineGame({
  name: 'coup-lite',
  players: { min: N_PLAYERS, max: N_PLAYERS },

  components: {
    // Public shared-deck declaration (the character pool); the actual deal is
    // semi-honest v1 (see module doc) and each hand stays hidden per player.
    deck: zk.deck.of([...CHARACTER_NAMES]),
    hand: zk.deck.deal(HAND_SIZE),
  },

  state: {
    public: (): PublicState => ({
      // See the module doc: local-mirror-only visibility, not real hiding.
      handsByPlayer: {} as Record<PlayerId, Hand>,
      influenceByPlayer: {} as Record<PlayerId, number>,
      deadByPlayer: {} as Record<PlayerId, [boolean, boolean]>,
      lastClaim: null as ClaimEntry | null,
      claimHistory: [] as ClaimEntry[],
      eliminated: null as PlayerId | null,
      winnerId: null as PlayerId | null,
    }),
    // Real data (matches Blackout's `state.secret` / Liar's Dice's own
    // `secret.dice` precedent — see the module doc): this player's actual
    // hand, either the REAL `card_membership`-provable hand
    // (`config.coupLite.handsByPlayer`, supplied by the on-chain runner) or a
    // deterministic seeded fallback for chain-free local play.
    secret: (ctx) => {
      const cfg = readConfig(ctx.config)
      const seed = (ctx.config.seed as string | undefined) ?? 'coup-lite-default-seed'
      const hand = cfg.handsByPlayer?.[ctx.id] ?? seededHand(`${seed}:${ctx.id}`)
      return { hand }
    },
  },

  setup: (state: MatchState, ctx: SetupContext): MatchState => {
    const cfg = readConfig(ctx.config)
    const seed = (ctx.config.seed as string | undefined) ?? 'coup-lite-default-seed'
    const hands: Record<PlayerId, Hand> = {}
    const influence: Record<PlayerId, number> = {}
    const dead: Record<PlayerId, [boolean, boolean]> = {}
    for (const p of ctx.players) {
      hands[p.id] = cfg.handsByPlayer?.[p.id] ?? seededHand(`${seed}:${p.id}`)
      influence[p.id] = START_INFLUENCE
      dead[p.id] = [false, false]
    }
    return {
      ...state,
      public: { ...state.public, handsByPlayer: hands, influenceByPlayer: influence, deadByPlayer: dead },
    }
  },

  turn: {
    order: 'clockwise',
    moves: {
      claim: {
        // Public claim to hold `character` — no ZK binding by itself (the
        // hidden fact is the hand's contents, proven only if challenged).
        legal: (view: PlayerView): Move[] =>
          CHARACTERS.map((character) => ({ type: 'claim', character })),
        apply: (state: MatchState, move: Move, ctx: MoveContext): MatchState => {
          const entry: ClaimEntry = { player: ctx.playerId, character: move.character as number }
          return {
            ...state,
            public: {
              ...state.public,
              lastClaim: entry,
              claimHistory: [...(state.public.claimHistory as ClaimEntry[]), entry],
            },
          }
        },
      },

      challenge: {
        // Binds this move to "the target proves in ZK that the claimed
        // character is in their committed hand, or the challenge stands as a
        // caught bluff" once ZK-secured — inert marker in the local engine
        // (see the module doc), real on-chain via `prove_hold`/`reveal_card`
        // in `runner.ts`.
        zkp: zk.deck.proveHoldOrBluff(),

        // See the module doc's turn-structure deviation note: only legal
        // for the player whose turn falls immediately after a still-standing
        // claim by someone else.
        legal: (view: PlayerView): Move[] => {
          const claim = (view.public.lastClaim as ClaimEntry | null) ?? null
          if (!claim || claim.player === view.self.id) return []
          return [{ type: 'challenge' }]
        },

        apply: (state: MatchState, _move: Move, ctx: MoveContext): MatchState => {
          const claim = state.public.lastClaim as ClaimEntry
          const hands = handsByPlayer(state)
          const targetHand: Hand = hands[claim.player] ?? [0, 0]
          const challenger = ctx.playerId
          const claimIsTrue = targetHand.includes(claim.character)
          const loser = claimIsTrue ? challenger : claim.player

          const { influenceByPlayer: nextInfluence, deadByPlayer: nextDead } = loseInfluence(state, loser)
          const nextState: MatchState = {
            ...state,
            public: {
              ...state.public,
              influenceByPlayer: nextInfluence,
              deadByPlayer: nextDead,
              lastClaim: null,
              eliminated: (nextInfluence[loser] ?? 0) === 0 ? loser : state.public.eliminated,
            },
          }
          const survivors = alivePlayers(nextState)
          const winnerId = survivors.length === 1 ? survivors[0]! : null
          return { ...nextState, public: { ...nextState.public, winnerId } }
        },
      },
    },
  },

  end: (state: MatchState): Outcome | null => {
    const winnerId = state.public.winnerId as PlayerId | null
    return winnerId ? { winner: winnerId } : null
  },
})
