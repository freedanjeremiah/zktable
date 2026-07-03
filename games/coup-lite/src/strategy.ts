// Deterministic (seeded) heuristics for playing Coup-lite headlessly: a
// claim policy (mostly truthful from own hand, with an occasional seeded
// bluff) and a challenge decision (challenge with higher probability when
// the standing claim names a character this player does NOT hold). Pure
// functions of (view, seed) - no I/O, no chain, no wall-clock - mirrors
// `games/liars-dice/src/strategy.ts`.
//
// IMPORTANT: like liars-dice's strategy (see that file's own note), this
// file deliberately reads ONLY `view.self.secret.hand` (this player's own
// hand) plus public claim history - never another player's actual hand - so
// the heuristic reflects what a real player (or the real on-chain game)
// legitimately knows.

import type { Move, PlayerView } from '@zktable/core'
import { CHARACTERS } from './coup-lite.js'
import type { ClaimEntry, Hand } from './coup-lite.js'

// --- seeded PRNG (mirrors liars-dice/src/strategy.ts) -----------------------

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

/** Deterministically pick one element of `items`, keyed by `seed`. Throws on an empty array. */
export function pickSeeded<T>(items: readonly T[], seed: string): T {
  if (items.length === 0) throw new Error('pickSeeded: items is empty')
  const rnd = mulberry32(hashSeed(seed))
  const index = Math.min(items.length - 1, Math.floor(rnd() * items.length))
  return items[index]!
}

// --- helpers -----------------------------------------------------------

function ownHand(view: PlayerView): Hand {
  return (view.self.secret.hand as Hand | undefined) ?? [0, 0]
}

// --- policy --------------------------------------------------------------

/** Claim a character this player actually holds (mostly), or occasionally bluff a character they don't. */
function chooseClaim(view: PlayerView, seed: string): Move {
  const hand = ownHand(view)
  const isBluff = pickSeeded([0, 1, 2, 3, 4], `${seed}:bluff`) === 0 // ~20% bluff rate
  if (isBluff) {
    const unheld = CHARACTERS.filter((c) => !hand.includes(c))
    const character = unheld.length > 0 ? pickSeeded(unheld, `${seed}:bluffchar`) : pickSeeded([...CHARACTERS], `${seed}:fallback`)
    return { type: 'claim', character }
  }
  return { type: 'claim', character: pickSeeded(hand, `${seed}:claimchar`) }
}

/**
 * Decide whether to challenge the standing claim (`view.legalMoves` already
 * confirms a `challenge` is legal here) or let it stand and make a new claim
 * instead. Suspicion is higher when this player's own hand does NOT contain
 * the claimed character (the only legitimate signal available), lower when
 * it does.
 */
export function chooseMove(view: PlayerView, seed: string): Move {
  const canChallenge = view.legalMoves.some((m) => m.type === 'challenge')
  const claim = (view.public.lastClaim as ClaimEntry | null) ?? null

  if (canChallenge && claim) {
    const hand = ownHand(view)
    const holdsClaimed = hand.includes(claim.character)
    const suspicionThreshold = holdsClaimed ? 0.15 : 0.55
    const roll = pickSeeded([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], `${seed}:challengeroll`) / 10
    if (roll < suspicionThreshold) {
      return { type: 'challenge' }
    }
  }
  return chooseClaim(view, seed)
}
