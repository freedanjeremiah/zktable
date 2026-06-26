import { createMatch, ticTacToe, type Move, type PlayerView } from '@zktable/core'
import { describe, expect, it } from 'vitest'
import { HeuristicAgent, RandomAgent } from './heuristic-agent.js'

describe('HeuristicAgent', () => {
  it('returns the policy-chosen move when it is legal', async () => {
    const agent = new HeuristicAgent((_view, legalMoves) => legalMoves[1]!)
    const view = { public: {}, self: { id: 'p1', secret: {} }, legalMoves: [] } as unknown as PlayerView
    const legalMoves: Move[] = [{ type: 'place', cell: 0 }, { type: 'place', cell: 1 }]

    await expect(agent.act(view, legalMoves)).resolves.toEqual({ type: 'place', cell: 1 })
  })

  it('throws if the policy returns a move that is not legal', async () => {
    const agent = new HeuristicAgent(() => ({ type: 'place', cell: 999 }))
    const view = { public: {}, self: { id: 'p1', secret: {} }, legalMoves: [] } as unknown as PlayerView
    const legalMoves: Move[] = [{ type: 'place', cell: 0 }]

    await expect(agent.act(view, legalMoves)).rejects.toThrow(/illegal move/i)
  })

  it('plays ticTacToe to completion through Match, only ever submitting legal moves', async () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    // Always take the first legal move — deterministic, and every candidate
    // is legal by construction (comes straight from Match.view).
    const agent = new HeuristicAgent((_view, legalMoves) => legalMoves[0]!)

    let guard = 0
    while (match.state.status !== 'finished') {
      if (++guard > 50) throw new Error('runaway game loop')
      const current = match.state.turn.current
      const view = match.view(current)
      const move = await agent.act(view, view.legalMoves)
      match.submit(current, move)
    }

    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).not.toBeNull()
  })
})

describe('RandomAgent', () => {
  it('only ever chooses a move from legalMoves', async () => {
    const agent = new RandomAgent('seed-a')
    const view = { public: {}, self: { id: 'p1', secret: {} }, legalMoves: [] } as unknown as PlayerView
    const legalMoves: Move[] = Array.from({ length: 9 }, (_, i) => ({ type: 'place', cell: i }))

    for (let i = 0; i < 25; i++) {
      const move = await agent.act(view, legalMoves)
      expect(legalMoves).toContainEqual(move)
    }
  })

  it('is deterministic: same seed -> same move sequence', async () => {
    const view = { public: {}, self: { id: 'p1', secret: {} }, legalMoves: [] } as unknown as PlayerView
    const legalMoves: Move[] = Array.from({ length: 9 }, (_, i) => ({ type: 'place', cell: i }))

    const a = new RandomAgent('reproducible-seed')
    const b = new RandomAgent('reproducible-seed')

    const movesA: Move[] = []
    const movesB: Move[] = []
    for (let i = 0; i < 10; i++) {
      movesA.push(await a.act(view, legalMoves))
      movesB.push(await b.act(view, legalMoves))
    }

    expect(movesA).toEqual(movesB)
  })

  it('different seeds produce a different move sequence (with high probability)', async () => {
    const view = { public: {}, self: { id: 'p1', secret: {} }, legalMoves: [] } as unknown as PlayerView
    const legalMoves: Move[] = Array.from({ length: 9 }, (_, i) => ({ type: 'place', cell: i }))

    const a = new RandomAgent('seed-one')
    const b = new RandomAgent('seed-two')

    const movesA: Move[] = []
    const movesB: Move[] = []
    for (let i = 0; i < 10; i++) {
      movesA.push(await a.act(view, legalMoves))
      movesB.push(await b.act(view, legalMoves))
    }

    expect(movesA).not.toEqual(movesB)
  })

  it('plays ticTacToe to completion through Match, only ever submitting legal moves', async () => {
    const match = createMatch(ticTacToe, [{ id: 'p1' }, { id: 'p2' }])
    const agentP1 = new RandomAgent('ttt-p1')
    const agentP2 = new RandomAgent('ttt-p2')

    let guard = 0
    while (match.state.status !== 'finished') {
      if (++guard > 50) throw new Error('runaway game loop')
      const current = match.state.turn.current
      const agent = current === 'p1' ? agentP1 : agentP2
      const view = match.view(current)
      const move = await agent.act(view, view.legalMoves)
      expect(view.legalMoves).toContainEqual(move)
      match.submit(current, move)
    }

    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).not.toBeNull()
  })
})
