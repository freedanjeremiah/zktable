// Deterministic (seeded) heuristics for playing Blackout headlessly: an
// evading phantom and pursuing investigators. Pure functions of
// (view, graph, seed) — no I/O, no chain, no wall-clock — so the exact same
// seed + game history always produces the exact same moves.

import type { Move, PlayerView } from '@zktable/core'
import type { Graph } from './map.js'

// --- seeded PRNG ---------------------------------------------------------

/** FNV-1a string hash -> 32-bit unsigned seed. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: small, fast, deterministic PRNG -> [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Deterministically pick one element of `items`, keyed by `seed`. Throws on an empty array. */
export function pickSeeded<T>(items: readonly T[], seed: string): T {
  if (items.length === 0) throw new Error('pickSeeded: items is empty')
  const rnd = mulberry32(hashSeed(seed))
  const index = Math.min(items.length - 1, Math.floor(rnd() * items.length))
  return items[index]!
}

// --- graph distance --------------------------------------------------------

/** BFS shortest-path distances from `source`, ignoring ticket type (pure graph connectivity). */
export function bfsDistances(graph: Graph, source: number): Map<number, number> {
  const dist = new Map<number, number>([[source, 0]])
  const queue: number[] = [source]
  let head = 0
  while (head < queue.length) {
    const node = queue[head++]!
    const d = dist.get(node)!
    for (const { to } of graph.neighbors(node)) {
      if (!dist.has(to)) {
        dist.set(to, d + 1)
        queue.push(to)
      }
    }
  }
  return dist
}

// --- strategies --------------------------------------------------------

type InvestigatorNodes = Record<string, number>
type RevealEntry = { round: number; node: number }

/**
 * Evading phantom: among this turn's legal moves, prefer the one(s) that
 * maximize the shortest-path distance from every known investigator node
 * (unknown investigators just means "no known threat" -> pick freely).
 * Ties (including ticket-type ties) are broken by the seed, so play varies
 * run to run without losing determinism for a fixed seed.
 */
export function phantomMove(view: PlayerView, graph: Graph, seed: string): Move {
  const moves = view.legalMoves
  if (moves.length === 0) throw new Error('phantomMove: no legal moves available')

  const investigatorNodes = Object.values(
    (view.public.investigatorNodes as InvestigatorNodes | undefined) ?? {},
  )
  if (investigatorNodes.length === 0) {
    return pickSeeded(moves, `${seed}:phantom:blind`)
  }

  const distances = investigatorNodes.map((node) => bfsDistances(graph, node))
  const scored = moves.map((move) => {
    const to = move.to as number
    const minDistance = Math.min(...distances.map((d) => d.get(to) ?? Number.POSITIVE_INFINITY))
    return { move, score: minDistance }
  })
  const best = Math.max(...scored.map((s) => s.score))
  const bestMoves = scored.filter((s) => s.score === best).map((s) => s.move)
  return pickSeeded(bestMoves, `${seed}:phantom:evade`)
}

/**
 * Pursuing investigator: step toward the phantom's last revealed node. Before
 * any reveal has happened there is nothing to chase, so it falls back to a
 * seeded patrol (deterministic, but not a real pursuit).
 */
export function investigatorMove(view: PlayerView, graph: Graph, seed: string): Move {
  const moves = view.legalMoves
  if (moves.length === 0) throw new Error('investigatorMove: no legal moves available')

  const revealLog = (view.public.revealLog as RevealEntry[] | undefined) ?? []
  const target = revealLog.at(-1)?.node
  if (target === undefined) {
    return pickSeeded(moves, `${seed}:investigator:patrol`)
  }

  const distances = bfsDistances(graph, target)
  const scored = moves.map((move) => ({
    move,
    score: distances.get(move.to as number) ?? Number.POSITIVE_INFINITY,
  }))
  const best = Math.min(...scored.map((s) => s.score))
  const bestMoves = scored.filter((s) => s.score === best).map((s) => s.move)
  return pickSeeded(bestMoves, `${seed}:investigator:pursue:${target}`)
}
