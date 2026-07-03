// M8.3 gap coverage: the shuffle pipeline against REAL tools (zktable-graph
// + nargo + bb, same requirement as @zktable/circuits' prover tests).
// Verifies the spec's two promises: proveShuffle's leaves are exactly the
// per-card commitments the independent `deal`-style derivation produces for
// the dealt hands, and shuffleLocalVerify accepts the real proof / rejects
// a tampered one.

import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { CardProver } from './card-prover.js'
import { GRAPH_TOOLS_BIN, toolEnv } from './paths.js'

// A fixed seed (any field value works — the permutation is derived, not chosen).
const SEED = '0x2dabe9b6972bc1f021a8a6e14586631d4ea9a4802712a94c07626ff70325f309'
const SALTS = Array.from({ length: 15 }, (_, i) => BigInt(5001 + i))

describe('CardProver.proveShuffle (real prover pipeline)', () => {
  it('leaves match zktable-graph commitments for the dealt hands, and local verify accepts/rejects', async () => {
    const prover = new CardProver()
    const shuffle = await prover.proveShuffle(SEED, SALTS)

    expect(shuffle.cards).toHaveLength(15)
    expect(shuffle.leavesHex).toHaveLength(15)
    expect(shuffle.proof.length).toBe(14592)
    expect(shuffle.publicInputs.length).toBe(16 * 32) // seed | 15 leaves

    // Position-assigned hands: player p = positions 2p, 2p+1. Each leaf must
    // equal the INDEPENDENTLY-computed per-card commitment for that (card,
    // salt) — the same Poseidon2 form card_membership proves against.
    for (const position of [0, 1, 2, 3]) {
      const out = execFileSync(
        GRAPH_TOOLS_BIN,
        ['commit', '--value', String(shuffle.cards[position]!), '--salt', shuffle.salts[position]!],
        { env: toolEnv(), encoding: 'utf8' },
      ).trim()
      expect(shuffle.leavesHex[position]!.replace(/^0x/, '')).toBe(out.replace(/^0x/, ''))
    }

    await expect(prover.shuffleLocalVerify(shuffle.proof, shuffle.publicInputs)).resolves.toBe(true)

    const tampered = new Uint8Array(shuffle.proof)
    tampered[100]! ^= 0x01
    await expect(prover.shuffleLocalVerify(tampered, shuffle.publicInputs)).resolves.toBe(false)
  }, 300_000)
})
