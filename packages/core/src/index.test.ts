import { describe, expect, it } from 'vitest'
import { createMatch, defineGame, ticTacToe, zk } from './index.js'

describe('package entrypoint', () => {
  it('exports defineGame, createMatch, zk, and the tic-tac-toe reference game', () => {
    expect(typeof defineGame).toBe('function')
    expect(typeof createMatch).toBe('function')
    expect(typeof zk.hidden.node).toBe('function')
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    expect(match.state.status).toBe('active')
  })
})
