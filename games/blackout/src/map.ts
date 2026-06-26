// The Blackout city map: loads `map/city.json` (100 nodes, 3 ticket types)
// and exposes typed adjacency, positions, and ticket-name lookups used by
// `blackout.ts` (legal-move enumeration) and `strategy.ts` (pathfinding).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GraphData, Ticket } from '@zktable/circuits'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Path to `map/city.json`, resolved relative to this package (not the caller's cwd). */
export const CITY_MAP_PATH = path.resolve(here, '../map/city.json')

export type CityMapFile = {
  name: string
  nodes: number[]
  positions: Record<string, [number, number]>
  bidirectional: boolean
  edges: Array<{ from: number; to: number; ticket: Ticket }>
  ticketTypes: Record<string, string>
}

export type Neighbor = { to: number; ticket: Ticket }

/** Minimal adjacency interface `strategy.ts` depends on — lets tests inject a fixture graph. */
export type Graph = {
  neighbors(node: number): Neighbor[]
}

export const TICKET_NAMES: Record<Ticket, string> = { 0: 'taxi', 1: 'bus', 2: 'rail' }

export function ticketName(ticket: Ticket): string {
  const name = TICKET_NAMES[ticket]
  if (!name) throw new Error(`map: unknown ticket id ${ticket}`)
  return name
}

function buildAdjacency(map: CityMapFile): Map<number, Neighbor[]> {
  const adjacency = new Map<number, Neighbor[]>()
  const add = (from: number, to: number, ticket: Ticket): void => {
    const list = adjacency.get(from) ?? []
    list.push({ to, ticket })
    adjacency.set(from, list)
  }
  for (const e of map.edges) {
    add(e.from, e.to, e.ticket)
    if (map.bidirectional !== false) add(e.to, e.from, e.ticket)
  }
  return adjacency
}

/** Loads and parses `map/city.json` from disk. Pure function of the file on disk. */
export function loadCityMap(filePath: string = CITY_MAP_PATH): CityMapFile {
  const raw = readFileSync(filePath, 'utf8')
  return JSON.parse(raw) as CityMapFile
}

/** Builds a `Graph` (adjacency lookups) from a loaded city map. */
export function buildGraph(map: CityMapFile): Graph {
  const adjacency = buildAdjacency(map)
  return {
    neighbors(node: number): Neighbor[] {
      return adjacency.get(node) ?? []
    },
  }
}

/** Converts a city map into the `GraphData` shape `@zktable/circuits`' `BoardGraph`/`BoardProver` expect. */
export function toGraphData(map: CityMapFile): GraphData {
  return { nodes: map.nodes, edges: map.edges, bidirectional: map.bidirectional }
}

/** The real Blackout city map, loaded once at import time. */
export const CITY = loadCityMap()

/** Adjacency over `CITY`. */
export const cityGraph: Graph = buildGraph(CITY)

/** `GraphData` for `CITY`, ready for `BoardGraph`/`BoardProver`. */
export const cityGraphData: GraphData = toGraphData(CITY)

/** [x, y] position of `node` on the city map, for rendering. */
export function position(node: number): [number, number] {
  const p = CITY.positions[String(node)]
  if (!p) throw new Error(`map: unknown node ${node}`)
  return p
}
