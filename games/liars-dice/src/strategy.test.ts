import { describe, expect, it } from 'vitest'
import { SIDES } from './liars-dice.js'
import { buildRoster, createLocalMatch } from './runner.js'
import { chooseMove, pickSeeded } from './strategy.js'

describe('pickSeeded', () => {
  it('is deterministic for a fixed seed', () => {
    expect(pickSeeded([1, 2, 3, 4, 5], 'fixed-seed')).toBe(pickSeeded([1, 2, 3, 4, 5], 'fixed-seed'))
  })

  it('throws on an empty array', () => {
    expect(() => pickSeeded([], 'seed')).toThrow(/empty/i)
  })
})

describe('chooseMove: opening bid (no standing bid)', () => {
  const roster = buildRoster()
  const [p1, p2] = roster.map((p) => p.id) as [string, string]

  it('bids truthfully from the player\'s own dice: claims a face it actually holds, quantity > 0', () => {
    const diceByPlayer = { [p1]: [4, 4, 4, 2, 6], [p2]: [1, 1, 1, 1, 1] }
    const match = createLocalMatch(roster, { diceByPlayer }, 'opening-bid-seed')
    const view = match.view(p1)

    const move = chooseMove(view, 'opening-bid-seed:p1')
    expect(move.type).toBe('bid')
    const quantity = move.quantity as number
    const face = move.face as number
    expect(face).toBe(4) // the face this player holds the most of (three 4s)
    expect(quantity).toBeGreaterThanOrEqual(1)
    // Should be among the view's actual legal moves.
    expect(view.legalMoves).toContainEqual(move)
  })

  it('is deterministic: same view + seed -> same move', () => {
    const diceByPlayer = { [p1]: [3, 3, 5, 2, 6], [p2]: [1, 1, 1, 1, 1] }
    const match = createLocalMatch(roster, { diceByPlayer }, 'determinism-seed')
    const view = match.view(p1)
    expect(chooseMove(view, 'same-seed')).toEqual(chooseMove(view, 'same-seed'))
  })

  it('every face in a returned bid is within [1, SIDES]', () => {
    const diceByPlayer = { [p1]: [1, 2, 3, 4, 5], [p2]: [6, 6, 6, 6, 6] }
    const match = createLocalMatch(roster, { diceByPlayer }, 'range-seed')
    const view = match.view(p1)
    const move = chooseMove(view, 'range-seed:check')
    expect(move.face as number).toBeGreaterThanOrEqual(1)
    expect(move.face as number).toBeLessThanOrEqual(SIDES)
  })
})

describe('chooseMove: challenge decision against a standing bid', () => {
  const roster = buildRoster()
  const [p1, p2] = roster.map((p) => p.id) as [string, string]

  it('challenges an implausible bid (far above what own dice + statistical expectation support)', () => {
    // p2 holds no dice matching face 6, and a bid of "10 x face 6" vastly
    // exceeds the 10 total dice in play even in the best case.
    const diceByPlayer = { [p1]: [1, 2, 3, 4, 5], [p2]: [1, 2, 3, 4, 5] }
    const match = createLocalMatch(roster, { diceByPlayer }, 'implausible-seed')
    match.submit(p1, { type: 'bid', quantity: 10, face: 6 })
    const view = match.view(p2)

    const move = chooseMove(view, 'implausible-seed:p2')
    expect(move).toEqual({ type: 'challenge' })
  })

  it('raises (does not fold) a plausible early bid', () => {
    const diceByPlayer = { [p1]: [6, 6, 6, 2, 3], [p2]: [6, 1, 2, 3, 4] }
    const match = createLocalMatch(roster, { diceByPlayer }, 'plausible-seed')
    // Own dice alone (3 sixes) already justify the opening claim of 2 sixes.
    match.submit(p1, { type: 'bid', quantity: 2, face: 6 })
    const view = match.view(p2)

    const move = chooseMove(view, 'plausible-seed:p2')
    expect(move.type).toBe('bid')
    expect(view.legalMoves).toContainEqual(move)
  })
})
