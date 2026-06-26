import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_GRAPH_TOOLS_BIN, toolEnv } from './paths.js'
import type { GraphData, GraphEdge, Ticket } from './types.js'

const execFileAsync = promisify(execFile)

function edgeKey(from: number, to: number, ticket: Ticket): string {
  return `${from}:${to}:${ticket}`
}

function canonicalEdgeSet(edges: GraphEdge[], bidirectional: boolean): Set<string> {
  const set = new Set<string>()
  for (const e of edges) {
    set.add(edgeKey(e.from, e.to, e.ticket))
    if (bidirectional) {
      set.add(edgeKey(e.to, e.from, e.ticket))
    }
  }
  return set
}

/**
 * A public transit graph. Wraps the `zktable-graph` Rust CLI for the
 * hash-dependent operations (edge-tree root, Poseidon commitments) and does
 * pure, local edge-membership checks in TS.
 */
export class BoardGraph {
  readonly data: GraphData
  private readonly graphToolsBin: string
  private readonly edges: Set<string>

  constructor(data: GraphData, opts?: { graphToolsBin?: string }) {
    this.data = data
    this.graphToolsBin = opts?.graphToolsBin ?? DEFAULT_GRAPH_TOOLS_BIN
    this.edges = canonicalEdgeSet(data.edges, data.bidirectional ?? true)
  }

  /** Pure, local check: is (from, to, ticket) a legal edge of this graph? */
  hasEdge(from: number, to: number, ticket: Ticket): boolean {
    return this.edges.has(edgeKey(from, to, ticket))
  }

  /** Edge-tree root (hex), via `zktable-graph root`. */
  async root(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'zktable-graph-root-'))
    try {
      const graphPath = path.join(dir, 'graph.json')
      await writeFile(graphPath, JSON.stringify(this.data))
      const { stdout } = await execFileAsync(this.graphToolsBin, ['root', '--graph', graphPath], {
        env: toolEnv(),
      })
      return stdout.trim()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Poseidon2(node, salt) (hex), via `zktable-graph commit`. */
  async commit(node: number, salt: bigint): Promise<string> {
    const { stdout } = await execFileAsync(
      this.graphToolsBin,
      ['commit', '--node', String(node), '--salt', salt.toString()],
      { env: toolEnv() },
    )
    return stdout.trim()
  }
}
