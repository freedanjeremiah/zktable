import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { BoardGraph } from './graph.js'
import { DEFAULT_GRAPH_TOOLS_BIN, toolEnv } from './paths.js'
import type { GraphData } from './types.js'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_GRAPH_PATH = path.resolve(here, '../move_along/fixtures/test_graph.json')

async function loadFixtureGraph(): Promise<GraphData> {
  const raw = await readFile(FIXTURE_GRAPH_PATH, 'utf8')
  return JSON.parse(raw) as GraphData
}

describe('BoardGraph', () => {
  it('root() equals the raw `zktable-graph root` CLI output for the fixture graph', async () => {
    const data = await loadFixtureGraph()
    const graph = new BoardGraph(data)

    const { stdout } = await execFileAsync(
      DEFAULT_GRAPH_TOOLS_BIN,
      ['root', '--graph', FIXTURE_GRAPH_PATH],
      { env: toolEnv() },
    )

    await expect(graph.root()).resolves.toBe(stdout.trim())
  })

  it('commit(node, salt) equals the raw `zktable-graph commit` CLI output', async () => {
    const data = await loadFixtureGraph()
    const graph = new BoardGraph(data)

    const { stdout } = await execFileAsync(
      DEFAULT_GRAPH_TOOLS_BIN,
      ['commit', '--node', '1', '--salt', '111'],
      { env: toolEnv() },
    )

    await expect(graph.commit(1, 111n)).resolves.toBe(stdout.trim())
  })

  it('hasEdge respects bidirectional expansion and rejects non-edges', async () => {
    const data = await loadFixtureGraph()
    const graph = new BoardGraph(data)

    // Declared edge 1 -> 2 ticket 0.
    expect(graph.hasEdge(1, 2, 0)).toBe(true)
    // Bidirectional expansion: reverse direction is also legal.
    expect(graph.hasEdge(2, 1, 0)).toBe(true)
    // Wrong ticket on a real edge.
    expect(graph.hasEdge(1, 2, 1)).toBe(false)
    // Not an edge at all.
    expect(graph.hasEdge(0, 5, 0)).toBe(false)
  })

  it('hasEdge does not expand reverse edges when bidirectional is false', () => {
    const data: GraphData = {
      nodes: [0, 1],
      bidirectional: false,
      edges: [{ from: 0, to: 1, ticket: 0 }],
    }
    const graph = new BoardGraph(data)

    expect(graph.hasEdge(0, 1, 0)).toBe(true)
    expect(graph.hasEdge(1, 0, 0)).toBe(false)
  })
})
