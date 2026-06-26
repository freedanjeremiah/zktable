// Deterministic (seeded) heuristics for playing Liar's Dice headlessly: a
// bidding policy (mostly honest from own dice, with an occasional seeded
// bluff) and a challenge decision (challenge once a standing bid exceeds a
// plausibility threshold). Pure functions of (view, seed) — no I/O, no
// chain, no wall-clock — mirrors `games/blackout/src/strategy.ts`.
//
// IMPORTANT: unlike Blackout's local-mirror `diceByPlayer` (see
// `liars-dice.ts`'s module doc — kept in `public` state only so the pure
// `apply` reducer can resolve a challenge), this file deliberately reads
// ONLY `view.self.secret.dice` (this player's own roll) plus public bid
// history — never another player's actual dice — so the heuristic reflects
// what a real player (or the real on-chain game) legitimately knows. Other
// players' dice are estimated statistically (uniform over `SIDES`), exactly
// the "expected others" the brief asks for.

import type { Move, PlayerView } from '@zktable/core'
import { DICE_PER_PLAYER, N_PLAYERS, SIDES } from './liars-dice.js'
import type { BidEntry } from './liars-dice.js'

// --- seeded PRNG (mirrors blackout/src/strategy.ts) -------------------------

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

function ownDice(view: PlayerView): number[] {
  return (view.self.secret.dice as number[] | undefined) ?? []
}

function countFace(dice: number[], face: number): number {
  return dice.filter((d) => d === face).length
}

/** Total dice in play across all players — a public constant, not derived from anyone's hidden roll. */
function totalDiceInPlay(): number {
  return N_PLAYERS * DICE_PER_PLAYER
}

// --- policy --------------------------------------------------------------

/**
 * Opening bid (no standing bid yet): claim the face this player holds the
 * most of, plus a safe margin of 1 — usually truthful, since a player at
 * least knows their own dice support that count. A seeded coin flip
 * occasionally inflates the margin to 2 (a mild bluff) for variety.
 */
function openingBid(view: PlayerView, seed: string): Move {
  const own = ownDice(view)
  const counts = new Map<number, number>()
  for (const d of own) counts.set(d, (counts.get(d) ?? 0) + 1)

  let bestFace = pickSeeded([1, 2, 3, 4, 5, 6], `${seed}:openface`)
  let bestCount = counts.get(bestFace) ?? 0
  for (const [face, count] of counts) {
    if (count > bestCount) {
      bestFace = face
      bestCount = count
    }
  }
  const bluff = pickSeeded([0, 1], `${seed}:openbluff`) === 1
  const quantity = Math.max(1, bestCount + (bluff ? 2 : 1))
  return { type: 'bid', quantity, face: bestFace }
}

/**
 * Minimal legal raise over `cur`: same quantity at the next face, or (once
 * face wraps past `SIDES`) quantity + 1 at face 1.
 */
function minimalRaise(cur: BidEntry): Move {
  if (cur.face < SIDES) {
    return { type: 'bid', quantity: cur.quantity, face: cur.face + 1 }
  }
  return { type: 'bid', quantity: cur.quantity + 1, face: 1 }
}

/**
 * Given a standing bid, decide whether it is plausible enough to raise, or
 * implausible enough to challenge. Plausibility = this player's own matching
 * dice + the STATISTICAL expectation of the unknown dice (uniform over
 * `SIDES`), plus a seeded slack margin so different seeds fold at slightly
 * different thresholds (keeps games from being deterministradically
 * identical in outcome shape while remaining fully seed-deterministic).
 */
export function chooseMove(view: PlayerView, seed: string): Move {
  const cur = (view.public.currentBid as BidEntry | null) ?? null
  if (!cur) return openingBid(view, seed)

  const own = ownDice(view)
  const ownMatch = countFace(own, cur.face)
  const unknownCount = Math.max(totalDiceInPlay() - own.length, 0)
  const expected = ownMatch + unknownCount / SIDES
  const slack = pickSeeded([0.5, 0.75, 1, 1.25, 1.5], `${seed}:slack`)

  if (cur.quantity > expected + slack) {
    return { type: 'challenge' }
  }
  return minimalRaise(cur)
}
