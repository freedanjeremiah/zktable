import { describe, expect, it } from 'vitest'
import { createMatch } from '../engine.js'
import { ticTacToe } from './tic-tac-toe.js'

describe('tic-tac-toe', () => {
  it('starts with an empty 3x3 board and X/Y marks assigned by seat order', () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    expect(match.state.public.board).toEqual(Array(9).fill(null))
    expect(match.state.public.marks).toEqual({ p1: 'X', p2: 'Y' })
  })

  it('enumerates every empty cell as a legal `place` move for the current player', () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    const legal = match.legalMoves('p1')
    expect(legal).toHaveLength(9)
    expect(legal).toContainEqual({ type: 'place', cell: 0 })
    expect(legal).toContainEqual({ type: 'place', cell: 8 })
  })

  it('rejects placing on an already-occupied cell', () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    match.submit('p1', { type: 'place', cell: 0 })
    expect(() => match.submit('p2', { type: 'place', cell: 0 })).toThrow(/legal/i)
  })

  it('plays a full game to a win for p1 (top row)', () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    // p1: 0,1,2 (top row) ; p2: 3,4 (does not block)
    match.submit('p1', { type: 'place', cell: 0 })
    match.submit('p2', { type: 'place', cell: 3 })
    match.submit('p1', { type: 'place', cell: 1 })
    match.submit('p2', { type: 'place', cell: 4 })
    match.submit('p1', { type: 'place', cell: 2 })

    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).toEqual({ winner: 'p1' })
    expect(match.state.public.board).toEqual(['X', 'X', 'X', 'Y', 'Y', null, null, null, null])
  })

  it('throws when submitting after the game has finished', () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    match.submit('p1', { type: 'place', cell: 0 })
    match.submit('p2', { type: 'place', cell: 3 })
    match.submit('p1', { type: 'place', cell: 1 })
    match.submit('p2', { type: 'place', cell: 4 })
    match.submit('p1', { type: 'place', cell: 2 }) // p1 wins
    expect(() => match.submit('p2', { type: 'place', cell: 5 })).toThrow(/finished/i)
  })

  it('plays a full game to a draw', () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    // Board layout (index):
    // p1=X p2=Y
    // X X Y
    // Y Y X
    // X O... let's derive a known draw sequence:
    // Final board:
    // X Y X
    // X Y Y
    // Y X X
    const sequence: Array<[string, number]> = [
      ['p1', 0], // X . .
      ['p2', 1], // X Y .
      ['p1', 2], // X Y X
      ['p2', 4], // X Y X / . Y .
      ['p1', 3], // X Y X / X Y .
      ['p2', 5], // X Y X / X Y Y
      ['p1', 7], // X Y X / X Y Y / . X .
      ['p2', 6], // X Y X / X Y Y / Y X .
      ['p1', 8], // X Y X / X Y Y / Y X X
    ]
    for (const [player, cell] of sequence) {
      match.submit(player, { type: 'place', cell })
    }
    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).toEqual({ winner: 'draw' })
    expect(match.state.public.board).toEqual(['X', 'Y', 'X', 'X', 'Y', 'Y', 'Y', 'X', 'X'])
  })
})
