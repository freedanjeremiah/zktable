import { describe, expect, it } from 'vitest'
import { CHARACTERS } from './coup-lite.js'
import { buildRoster, createLocalMatch } from './runner.js'
import { chooseMove, pickSeeded } from './strategy.js'
import type { Hand } from './coup-lite.js'

describe('pickSeeded', () => {
  it('is deterministic for a fixed seed', () => {
    expect(pickSeeded([1, 2, 3, 4, 5], 'fixed-seed')).toBe(pickSeeded([1, 2, 3, 4, 5], 'fixed-seed'))
  })

  it('throws on an empty array', () => {
    expect(() => pickSeeded([], 'seed')).toThrow(/empty/i)
  })
})

describe('chooseMove: opening claim (no standing claim)', () => {
  const roster = buildRoster()
  const [p1, p2] = roster.map((p) => p.id) as [string, string]

  it('mostly claims a character actually held (own hand)', () => {
    const handsByPlayer = { [p1]: [2, 3] as Hand, [p2]: [0, 1] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'opening-claim-seed')
    const view = match.view(p1)

    const move = chooseMove(view, 'opening-claim-seed:p1:not-bluffing')
    expect(move.type).toBe('claim')
    expect(view.legalMoves).toContainEqual(move)
  })

  it('is deterministic: same view + seed -> same move', () => {
    const handsByPlayer = { [p1]: [2, 3] as Hand, [p2]: [0, 1] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'determinism-seed')
    const view = match.view(p1)
    expect(chooseMove(view, 'same-seed')).toEqual(chooseMove(view, 'same-seed'))
  })

  it('every claimed character is within the declared character pool', () => {
    const handsByPlayer = { [p1]: [2, 3] as Hand, [p2]: [0, 1] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'range-seed')
    const view = match.view(p1)
    const move = chooseMove(view, 'range-seed:check')
    expect(CHARACTERS).toContain(move.character as number)
  })
})

describe('chooseMove: challenge decision against a standing claim', () => {
  const roster = buildRoster()
  const [p1, p2] = roster.map((p) => p.id) as [string, string]

  it('never challenges its own claim (no legal challenge on the claimer\'s own turn)', () => {
    const handsByPlayer = { [p1]: [0, 1] as Hand, [p2]: [2, 3] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'own-claim-seed')
    match.submit(p1, { type: 'claim', character: 0 })
    // It is now p2's turn; p1 has no legal moves regardless of what
    // chooseMove might otherwise pick.
    expect(match.legalMoves(p1)).toEqual([])
  })

  it('when it challenges, the move is among the actual legal moves', () => {
    const handsByPlayer = { [p1]: [0, 1] as Hand, [p2]: [2, 3] as Hand }
    const match = createLocalMatch(roster, { handsByPlayer }, 'legal-seed')
    match.submit(p1, { type: 'claim', character: 4 })
    const view = match.view(p2)
    const move = chooseMove(view, 'legal-seed:p2')
    expect(view.legalMoves).toContainEqual(move)
  })
})
