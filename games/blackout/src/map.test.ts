import { describe, expect, it } from 'vitest'
import { buildGraph, CITY, cityGraph, cityGraphData, position, ticketName, toGraphData } from './map.js'
import type { CityMapFile } from './map.js'

describe('CITY (real map/city.json)', () => {
  it('loads 100 nodes and a non-empty edge list', () => {
    expect(CITY.nodes).toHaveLength(100)
    expect(CITY.edges.length).toBeGreaterThan(0)
  })

  it('declares bidirectional taxi/bus/rail ticket types', () => {
    expect(CITY.bidirectional).toBe(true)
    expect(CITY.ticketTypes).toEqual({ '0': 'taxi', '1': 'bus', '2': 'rail' })
  })
})

describe('ticketName', () => {
  it('maps ticket ids to names', () => {
    expect(ticketName(0)).toBe('taxi')
    expect(ticketName(1)).toBe('bus')
    expect(ticketName(2)).toBe('rail')
  })

  it('throws for an unknown ticket id', () => {
    // @ts-expect-error deliberately out of range
    expect(() => ticketName(9)).toThrow(/unknown ticket/i)
  })
})

describe('position', () => {
  it('returns the [x, y] position of a real node', () => {
    expect(position(1)).toEqual(CITY.positions['1'])
  })

  it('throws for an unknown node', () => {
    expect(() => position(99999)).toThrow(/unknown node/i)
  })
})

describe('buildGraph (adjacency)', () => {
  const fixture: CityMapFile = {
    name: 'fixture',
    nodes: [1, 2, 3],
    positions: { '1': [0, 0], '2': [1, 0], '3': [2, 0] },
    bidirectional: true,
    edges: [
      { from: 1, to: 2, ticket: 0 },
      { from: 2, to: 3, ticket: 1 },
    ],
    ticketTypes: { '0': 'taxi', '1': 'bus', '2': 'rail' },
  }

  it('expands edges in both directions when bidirectional', () => {
    const graph = buildGraph(fixture)
    expect(graph.neighbors(1)).toEqual([{ to: 2, ticket: 0 }])
    expect(graph.neighbors(2)).toEqual(
      expect.arrayContaining([
        { to: 1, ticket: 0 },
        { to: 3, ticket: 1 },
      ]),
    )
    expect(graph.neighbors(2)).toHaveLength(2)
  })

  it('does not expand reverse edges when bidirectional is false', () => {
    const graph = buildGraph({ ...fixture, bidirectional: false })
    expect(graph.neighbors(2)).toEqual([{ to: 3, ticket: 1 }])
    expect(graph.neighbors(3)).toEqual([])
  })

  it('returns an empty array for a node with no edges', () => {
    const graph = buildGraph(fixture)
    expect(graph.neighbors(12345)).toEqual([])
  })

  it('cityGraph (the real map) has edges for node 1 matching city.json', () => {
    const fromCityJson = CITY.edges.filter((e) => e.from === 1)
    for (const e of fromCityJson) {
      expect(cityGraph.neighbors(1)).toEqual(expect.arrayContaining([{ to: e.to, ticket: e.ticket }]))
    }
  })
})

describe('toGraphData', () => {
  it('carries nodes/edges/bidirectional through unchanged', () => {
    const fixture: CityMapFile = {
      name: 'fixture',
      nodes: [1, 2],
      positions: { '1': [0, 0], '2': [1, 0] },
      bidirectional: false,
      edges: [{ from: 1, to: 2, ticket: 2 }],
      ticketTypes: { '0': 'taxi', '1': 'bus', '2': 'rail' },
    }
    expect(toGraphData(fixture)).toEqual({
      nodes: [1, 2],
      edges: [{ from: 1, to: 2, ticket: 2 }],
      bidirectional: false,
    })
  })

  it('cityGraphData mirrors CITY', () => {
    expect(cityGraphData.nodes).toEqual(CITY.nodes)
    expect(cityGraphData.edges).toEqual(CITY.edges)
    expect(cityGraphData.bidirectional).toBe(CITY.bidirectional)
  })
})
