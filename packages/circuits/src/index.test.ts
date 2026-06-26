import { describe, expect, it } from 'vitest'
import { BoardGraph, BoardProver } from './index.js'

describe('index exports', () => {
  it('exposes BoardGraph and BoardProver as constructible classes', () => {
    const graph = new BoardGraph({ nodes: [0, 1], edges: [{ from: 0, to: 1, ticket: 0 }] })
    expect(graph.hasEdge(0, 1, 0)).toBe(true)

    const prover = new BoardProver()
    expect(prover).toBeInstanceOf(BoardProver)
  })
})
