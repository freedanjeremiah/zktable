import { describe, expect, it } from 'vitest'
import { DICE_PER_PLAYER, N_PLAYERS, SIDES, liarsDice } from './liars-dice.js'
import { buildRoster, createLocalMatch, playLocalMatch, stepLocalMatch } from './runner.js'
import type { BidEntry } from './liars-dice.js'

describe('liarsDice defineGame shape', () => {
  it('compiles via defineGame with the v1 2-player scope', () => {
    expect(liarsDice.def.name).toBe('liars-dice')
    expect(liarsDice.def.players.min).toBe(N_PLAYERS)
    expect(liarsDice.def.players.max).toBe(N_PLAYERS)
    expect(N_PLAYERS).toBe(2)
    expect(DICE_PER_PLAYER).toBe(5)
    expect(SIDES).toBe(6)
  })

  it('declares both move types', () => {
    expect(Object.keys(liarsDice.def.turn.moves).sort()).toEqual(['bid', 'challenge'])
  })
})

describe('a full local seeded game', () => {
  const roster = buildRoster()

  it('reaches a definite two-player outcome within a bounded number of moves', () => {
    const { match, steps } = playLocalMatch(roster, {}, 'liars-dice-local-seed-1')
    expect(match.state.status).toBe('finished')
    expect(steps.length).toBeGreaterThan(0)
    expect(match.state.outcome).not.toBeNull()
    const winner = match.state.outcome!.winner
    expect(roster.map((p) => p.id)).toContain(winner)

    // Exactly one player is eliminated, the other is the declared winner.
    const eliminated = match.state.public.eliminated as string
    expect(roster.map((p) => p.id)).toContain(eliminated)
    expect(eliminated).not.toBe(winner)

    // The game always ends on a `challenge` move (v1: single-round elimination).
    expect(steps.at(-1)!.move.type).toBe('challenge')
  })

  it('is fully deterministic for a fixed seed: same seed -> same steps and outcome', () => {
    const run1 = playLocalMatch(roster, {}, 'liars-dice-determinism-seed')
    const run2 = playLocalMatch(roster, {}, 'liars-dice-determinism-seed')
    expect(run2.steps).toEqual(run1.steps)
    expect(run2.match.state.outcome).toEqual(run1.match.state.outcome)
  })

  it('different seeds can roll different dice (fallback seeded roll is not constant)', () => {
    const a = createLocalMatch(roster, {}, 'seed-alpha')
    const b = createLocalMatch(roster, {}, 'seed-beta')
    const diceA = a.state.public.diceByPlayer as Record<string, number[]>
    const diceB = b.state.public.diceByPlayer as Record<string, number[]>
    expect(diceA).not.toEqual(diceB)
  })
})

describe('bid escalation enforced by the engine', () => {
  const roster = buildRoster()

  it('accepts a strictly-escalating bid and rejects a non-escalating one', () => {
    const match = createLocalMatch(roster, {}, 'escalation-seed')
    const [p1, p2] = roster.map((p) => p.id) as [string, string]

    match.submit(p1, { type: 'bid', quantity: 2, face: 3 })
    const cur = match.state.public.currentBid as BidEntry
    expect(cur).toEqual({ player: p1, quantity: 2, face: 3 })

    // Same quantity, same-or-lower face does not escalate -> not a legal move.
    expect(() => match.submit(p2, { type: 'bid', quantity: 2, face: 3 })).toThrow()
    expect(() => match.submit(p2, { type: 'bid', quantity: 2, face: 2 })).toThrow()
    expect(() => match.submit(p2, { type: 'bid', quantity: 1, face: 6 })).toThrow()

    // Same quantity, higher face DOES escalate.
    match.submit(p2, { type: 'bid', quantity: 2, face: 4 })
    expect(match.state.public.currentBid).toEqual({ player: p2, quantity: 2, face: 4 })
  })

  it('rejects a challenge before any bid has been made', () => {
    const match = createLocalMatch(roster, {}, 'no-bid-yet-seed')
    const p1 = match.state.turn.current
    expect(match.legalMoves(p1)).not.toContainEqual({ type: 'challenge' })
  })
})

describe('challenge resolution with known dice', () => {
  const roster = buildRoster()
  const [p1, p2] = roster.map((p) => p.id) as [string, string]

  it('the CHALLENGER loses when the true count meets or exceeds the bid', () => {
    // p1: [5,5,3,1,2] (two 5s); p2: [5,4,4,6,6] (one 5) -> three 5s total.
    const diceByPlayer = { [p1]: [5, 5, 3, 1, 2], [p2]: [5, 4, 4, 6, 6] }
    const match = createLocalMatch(roster, { diceByPlayer }, 'known-dice-seed-1')

    match.submit(p1, { type: 'bid', quantity: 3, face: 5 }) // true: exactly 3 fives
    match.submit(p2, { type: 'challenge' })

    expect(match.state.status).toBe('finished')
    expect(match.state.public.resolvedCount).toBe(3)
    expect(match.state.public.eliminated).toBe(p2) // challenger loses
    expect(match.state.outcome).toEqual({ winner: p1 })
  })

  it('the BIDDER loses when the true count is below the bid', () => {
    const diceByPlayer = { [p1]: [5, 5, 3, 1, 2], [p2]: [5, 4, 4, 6, 6] }
    const match = createLocalMatch(roster, { diceByPlayer }, 'known-dice-seed-2')

    match.submit(p1, { type: 'bid', quantity: 4, face: 5 }) // false: only 3 fives exist
    match.submit(p2, { type: 'challenge' })

    expect(match.state.status).toBe('finished')
    expect(match.state.public.resolvedCount).toBe(3)
    expect(match.state.public.eliminated).toBe(p1) // bidder loses
    expect(match.state.outcome).toEqual({ winner: p2 })
  })
})

describe('stepLocalMatch', () => {
  it('advances turn order between the two players', () => {
    const roster = buildRoster()
    const match = createLocalMatch(roster, {}, 'step-seed')
    const first = match.state.turn.current
    stepLocalMatch(match, 'step-seed')
    if (match.state.status === 'active') {
      expect(match.state.turn.current).not.toBe(first)
    }
  })
})
