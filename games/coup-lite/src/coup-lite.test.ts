import { describe, expect, it } from 'vitest'
import { CHARACTERS, HAND_SIZE, MAX_PLAYERS, MIN_PLAYERS, N_PLAYERS, START_INFLUENCE, coupLite } from './coup-lite.js'
import { buildRoster, createLocalMatch, playLocalMatch, stepLocalMatch } from './runner.js'
import type { ClaimEntry, Hand } from './coup-lite.js'

describe('coupLite defineGame shape', () => {
  it('compiles via defineGame with the referee-matching 2-4 player range', () => {
    expect(coupLite.def.name).toBe('coup-lite')
    expect(coupLite.def.players.min).toBe(MIN_PLAYERS)
    expect(coupLite.def.players.max).toBe(MAX_PLAYERS)
    expect(MIN_PLAYERS).toBe(2)
    expect(MAX_PLAYERS).toBe(4)
    expect(N_PLAYERS).toBe(2) // default demo seat count
    expect(HAND_SIZE).toBe(2)
    expect(START_INFLUENCE).toBe(2)
    expect(CHARACTERS).toHaveLength(5)
  })

  it('declares both move types', () => {
    expect(Object.keys(coupLite.def.turn.moves).sort()).toEqual(['challenge', 'claim'])
  })
})

describe('a full local seeded game', () => {
  const roster = buildRoster()

  it('reaches a definite two-player outcome within a bounded number of moves', () => {
    const { match, steps } = playLocalMatch(roster, {}, 'coup-lite-local-seed-1')
    expect(match.state.status).toBe('finished')
    expect(steps.length).toBeGreaterThan(0)
    expect(match.state.outcome).not.toBeNull()
    const winner = match.state.outcome!.winner
    expect(roster.map((p) => p.id)).toContain(winner)

    const eliminatedIds = match.state.public.eliminatedIds as string[]
    expect(eliminatedIds).toHaveLength(1)
    expect(roster.map((p) => p.id)).toContain(eliminatedIds[0])
    expect(eliminatedIds[0]).not.toBe(winner)

    // The game always ends on a `challenge` move (the only move that can end it).
    expect(steps.at(-1)!.move.type).toBe('challenge')
  })

  it('is fully deterministic for a fixed seed: same seed -> same steps and outcome', () => {
    const run1 = playLocalMatch(roster, {}, 'coup-lite-determinism-seed')
    const run2 = playLocalMatch(roster, {}, 'coup-lite-determinism-seed')
    expect(run2.steps).toEqual(run1.steps)
    expect(run2.match.state.outcome).toEqual(run1.match.state.outcome)
  })

  it('different seeds can deal different hands (fallback seeded hand is not constant)', () => {
    const a = createLocalMatch(roster, {}, 'seed-alpha')
    const b = createLocalMatch(roster, {}, 'seed-beta')
    const handsA = a.state.public.handsByPlayer as Record<string, Hand>
    const handsB = b.state.public.handsByPlayer as Record<string, Hand>
    expect(handsA).not.toEqual(handsB)
  })

  it('every dealt hand has 2 distinct characters', () => {
    const match = createLocalMatch(roster, {}, 'distinctness-seed')
    const hands = match.state.public.handsByPlayer as Record<string, Hand>
    for (const hand of Object.values(hands)) {
      expect(hand).toHaveLength(2)
      expect(hand[0]).not.toBe(hand[1])
    }
  })
})

describe('claim / challenge legality', () => {
  const roster = buildRoster()
  const [p1, p2] = roster.map((p) => p.id) as [string, string]

  it('a fresh match only offers claim moves (no standing claim to challenge)', () => {
    const match = createLocalMatch(roster, {}, 'no-claim-yet-seed')
    expect(match.legalMoves(p1)).not.toContainEqual({ type: 'challenge' })
    expect(match.legalMoves(p1).length).toBeGreaterThan(0)
    expect(match.legalMoves(p1).every((m) => m.type === 'claim')).toBe(true)
  })

  it('after a claim, the other player may challenge or claim again', () => {
    const match = createLocalMatch(roster, {}, 'after-claim-seed')
    match.submit(p1, { type: 'claim', character: 0 })
    const legal = match.legalMoves(p2)
    expect(legal).toContainEqual({ type: 'challenge' })
    expect(legal.some((m) => m.type === 'claim')).toBe(true)
  })

  it('a player can never challenge their own claim', () => {
    const match = createLocalMatch(roster, {}, 'self-challenge-seed')
    match.submit(p1, { type: 'claim', character: 0 })
    // It is now p2's turn; p1 has no legal moves until their turn returns.
    expect(match.legalMoves(p1)).toEqual([])
  })
})

describe('challenge resolution with known hands', () => {
  const roster = buildRoster()
  const [p1, p2] = roster.map((p) => p.id) as [string, string]

  it('a TRUE claim: the CHALLENGER loses an influence', () => {
    const handsByPlayer = { [p1]: [0, 1] as Hand, [p2]: [2, 3] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'true-claim-seed')

    match.submit(p1, { type: 'claim', character: 0 }) // p1 truly holds character 0
    match.submit(p2, { type: 'challenge' })

    expect(match.state.public.eliminatedIds).toEqual([]) // not eliminated (2 -> 1)
    const influence = match.state.public.influenceByPlayer as Record<string, number>
    expect(influence[p2]).toBe(1) // challenger lost an influence
    expect(influence[p1]).toBe(2)
    expect(match.state.status).toBe('active') // only one loss so far
  })

  it('a BLUFF claim: the CLAIMER loses an influence', () => {
    const handsByPlayer = { [p1]: [0, 1] as Hand, [p2]: [2, 3] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'bluff-claim-seed')

    match.submit(p1, { type: 'claim', character: 4 }) // p1 does NOT hold character 4
    match.submit(p2, { type: 'challenge' })

    const influence = match.state.public.influenceByPlayer as Record<string, number>
    expect(influence[p1]).toBe(1) // claimer (bluffer) lost an influence
    expect(influence[p2]).toBe(2)
  })

  it('losing a second influence eliminates a player and ends the game', () => {
    const handsByPlayer = { [p1]: [0, 1] as Hand, [p2]: [2, 3] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'elimination-seed')

    // Round 1: p1 truthfully claims 0; p2 challenges (a true claim -> the
    // CHALLENGER, p2, loses an influence). Turn wraps back to p1.
    match.submit(p1, { type: 'claim', character: 0 })
    match.submit(p2, { type: 'challenge' })
    expect(match.state.status).toBe('active')
    expect(match.state.turn.current).toBe(p1)

    // Round 2: p1 truthfully claims 1 again; p2 challenges again -> loses
    // their second (and last) influence -> eliminated -> Finished.
    match.submit(p1, { type: 'claim', character: 1 })
    match.submit(p2, { type: 'challenge' })

    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).toEqual({ winner: p1 })
    const influence = match.state.public.influenceByPlayer as Record<string, number>
    expect(influence[p2]).toBe(0)
  })
})

describe('stepLocalMatch', () => {
  it('advances turn order between the two players after a claim', () => {
    const roster = buildRoster()
    const match = createLocalMatch(roster, {}, 'step-seed')
    const first = match.state.turn.current
    stepLocalMatch(match, 'step-seed')
    if (match.state.status === 'active') {
      expect(match.state.turn.current).not.toBe(first)
    }
  })
})

describe('claimHistory bookkeeping', () => {
  it('records every claim in order', () => {
    const roster = buildRoster()
    const [p1] = roster.map((p) => p.id) as [string, string]
    const match = createLocalMatch(roster, {}, 'history-seed')
    match.submit(p1, { type: 'claim', character: 2 })
    const history = match.state.public.claimHistory as ClaimEntry[]
    expect(history).toEqual([{ player: p1, character: 2 }])
  })
})

describe('3-player elimination (M8.2 turn-skip)', () => {
  const roster = buildRoster(3)
  const [p1, p2, p3] = roster.map((p) => p.id) as [string, string, string]
  // Known hands so challenge outcomes are forced.
  const handsByPlayer = { [p1]: [0, 1] as Hand, [p2]: [2, 3] as Hand, [p3]: [4, 0] as Hand }

  it('skips an eliminated player and plays on to a survivor-of-3 win', () => {
    const match = createLocalMatch(roster, { handsByPlayer }, '3p-elimination-seed')

    // p2 bluffs twice; p3 (next active seat) catches it both times.
    // Loss 1: p2 claims 4 (not held), p3 challenges -> p2 down to 1.
    match.submit(p1, { type: 'claim', character: 0 })
    match.submit(p2, { type: 'claim', character: 4 })
    match.submit(p3, { type: 'challenge' })
    expect((match.state.public.influenceByPlayer as Record<string, number>)[p2]).toBe(1)
    expect(match.state.turn.current).toBe(p1)

    // Loss 2: p2 bluffs again, p3 challenges again -> p2 eliminated.
    match.submit(p1, { type: 'claim', character: 1 })
    match.submit(p2, { type: 'claim', character: 4 })
    match.submit(p3, { type: 'challenge' })
    expect(match.state.public.eliminatedIds).toEqual([p2])
    expect(match.state.status).toBe('active') // two players still standing

    // The turn walk must now SKIP p2: p3 -> p1 (p2 out), then p1 -> p3.
    expect(match.state.turn.current).toBe(p1)
    expect(match.legalMoves(p2)).toEqual([])
    match.submit(p1, { type: 'claim', character: 0 })
    expect(match.state.turn.current).toBe(p3)

    // p3 challenges p1's TRUE claim twice -> p3 eliminated -> p1 wins 3-player match.
    match.submit(p3, { type: 'challenge' })
    expect((match.state.public.influenceByPlayer as Record<string, number>)[p3]).toBe(1)
    match.submit(p1, { type: 'claim', character: 1 })
    match.submit(p3, { type: 'challenge' })

    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).toEqual({ winner: p1 })
    expect(match.state.public.eliminatedIds).toEqual([p2, p3])
  })
})
