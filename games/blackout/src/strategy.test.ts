import { describe, expect, it } from 'vitest'
import type { Move, PlayerView } from '@zktable/core'
import { bfsDistances, investigatorMove, phantomMove, pickSeeded } from './strategy.js'
import type { Graph } from './map.js'

// A small line graph: 1 - 2 - 3 - 4 - 5 (single taxi ticket edges), plus a
// shortcut 1 -> 5 (rail) so distance heuristics have something interesting
// to choose between.
const LINE_GRAPH: Graph = {
  neighbors(node: number) {
    const table: Record<number, { to: number; ticket: 0 | 1 | 2 }[]> = {
      1: [{ to: 2, ticket: 0 }, { to: 5, ticket: 2 }],
      2: [{ to: 1, ticket: 0 }, { to: 3, ticket: 0 }],
      3: [{ to: 2, ticket: 0 }, { to: 4, ticket: 0 }],
      4: [{ to: 3, ticket: 0 }, { to: 5, ticket: 0 }],
      5: [{ to: 4, ticket: 0 }, { to: 1, ticket: 2 }],
    }
    return table[node] ?? []
  },
}

function view(overrides: Partial<PlayerView>): PlayerView {
  return {
    public: {},
    self: { id: 'p', secret: {} },
    tickets: {},
    legalMoves: [],
    ...overrides,
  }
}

describe('pickSeeded', () => {
  it('throws on an empty array', () => {
    expect(() => pickSeeded([], 'seed')).toThrow(/empty/i)
  })

  it('is deterministic for a fixed seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    expect(pickSeeded(items, 'fixed')).toBe(pickSeeded(items, 'fixed'))
  })

  it('always returns an element of the input', () => {
    const items = [10, 20, 30]
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      expect(items).toContain(pickSeeded(items, seed))
    }
  })
})

describe('bfsDistances', () => {
  it('computes shortest-path distances ignoring ticket type', () => {
    const d = bfsDistances(LINE_GRAPH, 1)
    expect(d.get(1)).toBe(0)
    expect(d.get(2)).toBe(1)
    // Direct rail edge 1->5 beats the long way around (1-2-3-4-5 = 4 hops).
    expect(d.get(5)).toBe(1)
    expect(d.get(4)).toBe(2) // via the 1->5 shortcut then 5->4
  })

  it('is unreachable (absent) for a disconnected node', () => {
    const d = bfsDistances(LINE_GRAPH, 1)
    expect(d.has(999)).toBe(false)
  })
})

describe('phantomMove', () => {
  const movesFrom2: Move[] = [
    { type: 'move', to: 1, ticket: 0 },
    { type: 'move', to: 3, ticket: 0 },
  ]

  it('throws when there are no legal moves', () => {
    expect(() => phantomMove(view({ legalMoves: [] }), LINE_GRAPH, 'seed')).toThrow(/no legal moves/i)
  })

  it('picks freely (any legal move) when no investigator positions are known', () => {
    const v = view({ public: {}, legalMoves: movesFrom2 })
    const move = phantomMove(v, LINE_GRAPH, 'seed-a')
    expect(movesFrom2).toContainEqual(move)
  })

  it('prefers the move that maximizes distance from the nearest known investigator', () => {
    // Investigator sits at node 1. From node 2, moving to 3 increases
    // distance-from-1 (2) vs moving to 1 (0, walks right into them).
    const v = view({
      public: { investigatorNodes: { inv1: 1 } },
      legalMoves: movesFrom2,
    })
    const move = phantomMove(v, LINE_GRAPH, 'seed-b')
    expect(move).toEqual({ type: 'move', to: 3, ticket: 0 })
  })

  it('is deterministic for a fixed seed and moves', () => {
    const v = view({ public: { investigatorNodes: { inv1: 1 } }, legalMoves: movesFrom2 })
    expect(phantomMove(v, LINE_GRAPH, 'stable-seed')).toEqual(phantomMove(v, LINE_GRAPH, 'stable-seed'))
  })
})

describe('investigatorMove', () => {
  const movesFrom4: Move[] = [
    { type: 'move', to: 3, ticket: 0 },
    { type: 'move', to: 5, ticket: 0 },
  ]

  it('throws when there are no legal moves', () => {
    expect(() => investigatorMove(view({ legalMoves: [] }), LINE_GRAPH, 'seed')).toThrow(/no legal moves/i)
  })

  it('patrols (any legal move) when nothing has been revealed yet', () => {
    const v = view({ public: {}, legalMoves: movesFrom4 })
    const move = investigatorMove(v, LINE_GRAPH, 'seed-a')
    expect(movesFrom4).toContainEqual(move)
  })

  it('steps toward the last revealed node', () => {
    // Phantom was last seen at node 1. From node 4, moving to 5 lands one
    // hop from the target via the rail shortcut 5->1, closer than moving to
    // 3 (two hops away via 3-2-1).
    const v = view({
      public: { revealLog: [{ round: 3, node: 1 }] },
      legalMoves: movesFrom4,
    })
    const move = investigatorMove(v, LINE_GRAPH, 'seed-b')
    // distance(3 -> 1) = 2 (3-2-1); distance(5 -> 1) = 1 (5-1 rail). Investigator picks 5.
    expect(move).toEqual({ type: 'move', to: 5, ticket: 0 })
  })

  it('only considers the most recent reveal', () => {
    const v = view({
      public: {
        revealLog: [
          { round: 3, node: 999 }, // stale, unreachable — must be ignored
          { round: 8, node: 1 },
        ],
      },
      legalMoves: movesFrom4,
    })
    const move = investigatorMove(v, LINE_GRAPH, 'seed-c')
    expect(move).toEqual({ type: 'move', to: 5, ticket: 0 })
  })
})
