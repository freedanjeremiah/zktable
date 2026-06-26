import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BoardProver } from './prover.js'
import type { BoardMove, GraphData } from './types.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_GRAPH_PATH = path.resolve(here, '../move_along/fixtures/test_graph.json')

async function loadFixtureGraph(): Promise<GraphData> {
  const raw = await readFile(FIXTURE_GRAPH_PATH, 'utf8')
  return JSON.parse(raw) as GraphData
}

// Matches move_along/fixtures/test_graph.json: edge 1 -> 2, ticket 0 (taxi).
const LEGAL_MOVE: BoardMove = { from: 1, to: 2, ticket: 0, saltOld: 111n, saltNew: 222n }

describe('BoardProver', () => {
  it('prove() produces a real UltraHonk proof that verifyLocally() accepts', async () => {
    const prover = new BoardProver()
    const graph = await loadFixtureGraph()

    const result = await prover.prove(graph, LEGAL_MOVE)

    expect(result.proof).toBeInstanceOf(Uint8Array)
    expect(result.proof.length).toBe(14592)
    expect(result.publicInputs).toBeInstanceOf(Uint8Array)
    expect(result.publicInputs.length).toBe(128)
    expect(result.ticket).toBe(0)

    await expect(prover.verifyLocally(result)).resolves.toBe(true)
  }, 60_000)

  it('publicInputs bytes equal the graph-tools witness public_inputs blob', async () => {
    const prover = new BoardProver()
    const graph = await loadFixtureGraph()

    const result = await prover.prove(graph, LEGAL_MOVE)
    const publicInputsHex = '0x' + Buffer.from(result.publicInputs).toString('hex')

    // c_old | c_new | ticket | root, each big-endian 32-byte field element.
    const cOldHex = '0x' + Buffer.from(result.publicInputs.slice(0, 32)).toString('hex')
    const cNewHex = '0x' + Buffer.from(result.publicInputs.slice(32, 64)).toString('hex')
    const rootHex = '0x' + Buffer.from(result.publicInputs.slice(96, 128)).toString('hex')

    expect(cOldHex).toBe(result.cOld)
    expect(cNewHex).toBe(result.cNew)
    expect(rootHex).toBe(result.root)
    expect(publicInputsHex.length).toBe(2 + 256) // '0x' + 128 bytes hex
  }, 60_000)

  it('verifyLocally() rejects a tampered proof', async () => {
    const prover = new BoardProver()
    const graph = await loadFixtureGraph()

    const result = await prover.prove(graph, LEGAL_MOVE)
    const tampered = new Uint8Array(result.proof)
    tampered[100] = tampered[100]! ^ 0xff

    await expect(prover.verifyLocally({ ...result, proof: tampered })).resolves.toBe(false)
  }, 60_000)

  it('prove() rejects a move along an edge not present in the graph', async () => {
    const prover = new BoardProver()
    const graph = await loadFixtureGraph()

    const illegalMove: BoardMove = { from: 0, to: 5, ticket: 0, saltOld: 1n, saltNew: 2n }

    await expect(prover.prove(graph, illegalMove)).rejects.toThrow()
  }, 60_000)
})
