import { describe, expect, it } from 'vitest'
import { DICE_PER_PLAYER, MAX_PLAYERS, MIN_PLAYERS, N_PLAYERS, SIDES, liarsDice } from './liars-dice.js'
import { buildRoster, createLocalMatch, playLocalMatch, stepLocalMatch } from './runner.js'
import type { BidEntry } from './liars-dice.js'

describe('liarsDice defineGame shape', () => {
  it('compiles via defineGame with the M8.2 2-6 player local range', () => {
    expect(liarsDice.def.name).toBe('liars-dice')
    expect(liarsDice.def.players.min).toBe(MIN_PLAYERS)
    expect(liarsDice.def.players.max).toBe(MAX_PLAYERS)
    expect(MIN_PLAYERS).toBe(2)
    expect(MAX_PLAYERS).toBe(6)
    expect(N_PLAYERS).toBe(2) // default demo seat count; on-chain v1 scope
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

    // Exactly one player runs out of dice; the other is the declared winner.
    const eliminatedIds = match.state.public.eliminatedIds as string[]
    expect(eliminatedIds).toHaveLength(1)
    expect(roster.map((p) => p.id)).toContain(eliminatedIds[0])
    expect(eliminatedIds[0]).not.toBe(winner)

    // Multi-round die loss (default): more than one challenge round happens.
    expect(match.state.public.roundNumber as number).toBeGreaterThan(1)

    // The game always ends on a `challenge` move (the only move that can end it).
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
    // lossMode 'seat' mirrors the v1 on-chain referee: one challenge decides.
    const diceByPlayer = { [p1]: [5, 5, 3, 1, 2], [p2]: [5, 4, 4, 6, 6] }
    const match = createLocalMatch(roster, { diceByPlayer, lossMode: 'seat' }, 'known-dice-seed-1')

    match.submit(p1, { type: 'bid', quantity: 3, face: 5 }) // true: exactly 3 fives
    match.submit(p2, { type: 'challenge' })

    expect(match.state.status).toBe('finished')
    expect(match.state.public.resolvedCount).toBe(3)
    expect(match.state.public.eliminatedIds).toEqual([p2]) // challenger loses
    expect(match.state.outcome).toEqual({ winner: p1 })
  })

  it('the BIDDER loses when the true count is below the bid', () => {
    const diceByPlayer = { [p1]: [5, 5, 3, 1, 2], [p2]: [5, 4, 4, 6, 6] }
    const match = createLocalMatch(roster, { diceByPlayer, lossMode: 'seat' }, 'known-dice-seed-2')

    match.submit(p1, { type: 'bid', quantity: 4, face: 5 }) // false: only 3 fives exist
    match.submit(p2, { type: 'challenge' })

    expect(match.state.status).toBe('finished')
    expect(match.state.public.resolvedCount).toBe(3)
    expect(match.state.public.eliminatedIds).toEqual([p1]) // bidder loses
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

describe('multi-round die loss + elimination (M8.2)', () => {
  const roster = buildRoster(3)
  const [p1, p2, p3] = roster.map((p) => p.id) as [string, string, string]

  it('a lost challenge costs one die and starts a fresh round', () => {
    // p1 truthfully bids three 5s; p2 challenges and loses ONE die.
    const diceByPlayer = { [p1]: [5, 5, 3, 1, 2], [p2]: [5, 4, 4, 6, 6], [p3]: [1, 1, 2, 2, 3] }
    const match = createLocalMatch(roster, { diceByPlayer }, '3p-die-loss-seed')

    match.submit(p1, { type: 'bid', quantity: 3, face: 5 }) // true: 3 fives across 15 dice
    match.submit(p2, { type: 'challenge' })

    expect(match.state.status).toBe('active')
    const counts = match.state.public.diceCountByPlayer as Record<string, number>
    expect(counts[p2]).toBe(4)
    expect(counts[p1]).toBe(5)
    expect(match.state.public.roundNumber).toBe(2)
    expect(match.state.public.currentBid).toBeNull()
    // Fresh rolls: p2 now has 4 dice, others 5.
    const rolls = match.state.public.diceByPlayer as Record<string, number[]>
    expect(rolls[p2]).toHaveLength(4)
    expect(rolls[p1]).toHaveLength(5)
    expect(rolls[p3]).toHaveLength(5)
  })

  it('a full 3-player game eliminates players one die at a time until one remains', () => {
    const { match } = playLocalMatch(roster, {}, '3p-tournament-seed')
    expect(match.state.status).toBe('finished')
    const winner = match.state.outcome!.winner as string
    const eliminatedIds = match.state.public.eliminatedIds as string[]
    expect(eliminatedIds).toHaveLength(2)
    expect(eliminatedIds).not.toContain(winner)
    const counts = match.state.public.diceCountByPlayer as Record<string, number>
    for (const id of eliminatedIds) expect(counts[id]).toBe(0)
    expect(counts[winner]).toBeGreaterThan(0)
  })
})
