// `CardProver` - orchestrates the full `card_membership` pipeline against
// REAL tools (mirrors `games/liars-dice/src/dice-prover.ts`'s shape, which
// itself mirrors `@zktable/circuits`'s `BoardProver`): writes the witness via
// `zktable-graph card-witness`/`deal`, executes the circuit via `nargo`, and
// proves via `bb`. No mocks - every call produces a real UltraHonk proof over
// a real committed hand.
//
// HONEST SIMPLIFICATION (see `liars-dice.ts`... no, see `coup-lite.ts`'s
// module doc / the coup-referee's module doc / PRD SS7.2): hands are dealt by
// a semi-honest orchestrator (this class, off-chain) - not a ZK-proven valid
// shuffle. The `card_membership` proof this class produces IS the real,
// load-bearing ZK: it proves a claimed character is genuinely in a player's
// committed hand without revealing which card, or the other card's identity.

import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  CARD_MEMBERSHIP_CIRCUIT_DIR,
  DEFAULT_BB_BIN,
  DEFAULT_NARGO_BIN,
  GRAPH_TOOLS_BIN,
  toolEnv,
} from './paths.js'

const execFileAsync = promisify(execFile)

type DealJson = {
  cards: string[]
  salts: string[]
  commitments: string[]
}

type CardWitnessJson = {
  claimed_card: string
  held_index: number
  cards: string[]
  commitments: string[]
  public_inputs: string
}

export type DealtHand = { commitmentsHex: [string, string] }

export type CardProof = {
  proof: Uint8Array
  publicInputs: Uint8Array
  claimed: bigint
  commitmentsHex: [string, string]
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export type CardProverOptions = {
  circuitDir?: string
  graphToolsBin?: string
  nargoBin?: string
  bbBin?: string
  workDir?: string
}

export class CardProver {
  private readonly circuitDir: string
  private readonly graphToolsBin: string
  private readonly nargoBin: string
  private readonly bbBin: string
  private readonly workDir: string
  private readonly env: NodeJS.ProcessEnv

  constructor(opts: CardProverOptions = {}) {
    this.circuitDir = opts.circuitDir ?? CARD_MEMBERSHIP_CIRCUIT_DIR
    this.graphToolsBin = opts.graphToolsBin ?? GRAPH_TOOLS_BIN
    this.nargoBin = opts.nargoBin ?? DEFAULT_NARGO_BIN
    this.bbBin = opts.bbBin ?? DEFAULT_BB_BIN
    this.workDir = opts.workDir ?? os.tmpdir()
    this.env = toolEnv()
  }

  private get targetDir(): string {
    return path.join(this.circuitDir, 'target')
  }
  private get bytecodePath(): string {
    return path.join(this.targetDir, 'card_membership.json')
  }
  private get vkPath(): string {
    return path.join(this.targetDir, 'vk')
  }

  /** Compile the circuit once if `target/card_membership.json` is missing. */
  async ensureCompiled(): Promise<void> {
    if (await exists(this.bytecodePath)) return
    await execFileAsync(this.nargoBin, ['compile'], { cwd: this.circuitDir, env: this.env })
  }

  /** Generate the verification key once if `target/vk` is missing. */
  async ensureVk(): Promise<void> {
    await this.ensureCompiled()
    if (await exists(this.vkPath)) return
    await execFileAsync(
      this.bbBin,
      [
        'write_vk',
        '--scheme',
        'ultra_honk',
        '--oracle_hash',
        'keccak',
        '--bytecode_path',
        this.bytecodePath,
        '--output_path',
        this.targetDir,
        '--output_format',
        'bytes_and_fields',
      ],
      { env: this.env },
    )
  }

  /**
   * `zktable-graph deal --cards c0,c1 --salts s0,s1` - the (semi-honest,
   * off-chain) dealer's per-card commitments for one player's hand. See the
   * module doc: this does NOT prove a valid shuffle over a shared deck.
   */
  async deal(cards: [bigint, bigint], salts: [bigint, bigint]): Promise<DealtHand> {
    const { stdout } = await execFileAsync(
      this.graphToolsBin,
      ['deal', '--cards', cards.join(','), '--salts', salts.join(',')],
      { env: this.env },
    )
    const parsed = JSON.parse(stdout) as DealJson
    const [c0, c1] = parsed.commitments
    if (!c0 || !c1) throw new Error('deal: expected exactly 2 commitments')
    return { commitmentsHex: [c0, c1] }
  }

  /**
   * Full pipeline for one "prove-hold" claim: `zktable-graph card-witness` ->
   * `nargo execute` -> `bb prove`. Runs entirely inside an isolated temp dir;
   * never touches `card_membership/Prover.toml` or `card_membership/target/`
   * (besides the shared, idempotent compiled bytecode).
   */
  async proveHold(
    claimed: bigint,
    cards: [bigint, bigint],
    salts: [bigint, bigint],
    heldIndex: 0 | 1,
  ): Promise<CardProof> {
    await this.ensureCompiled()

    const dir = await mkdtemp(path.join(this.workDir, 'zktable-card-prove-'))
    try {
      const proverTomlPath = path.join(dir, 'Prover')
      const witnessJsonPath = path.join(dir, 'witness.json')
      const witnessOutPath = path.join(dir, 'witness')

      await execFileAsync(
        this.graphToolsBin,
        [
          'card-witness',
          '--claimed',
          claimed.toString(),
          '--cards',
          cards.join(','),
          '--salts',
          salts.join(','),
          '--held',
          String(heldIndex),
          '--prover',
          `${proverTomlPath}.toml`,
          '--json',
          witnessJsonPath,
        ],
        { env: this.env },
      )

      const witness = JSON.parse(await readFile(witnessJsonPath, 'utf8')) as CardWitnessJson

      await execFileAsync(this.nargoBin, ['execute', '--prover-name', proverTomlPath, witnessOutPath], {
        cwd: this.circuitDir,
        env: this.env,
      })

      await execFileAsync(
        this.bbBin,
        [
          'prove',
          '--scheme',
          'ultra_honk',
          '--oracle_hash',
          'keccak',
          '--bytecode_path',
          this.bytecodePath,
          '--witness_path',
          `${witnessOutPath}.gz`,
          '--output_path',
          dir,
          '--output_format',
          'bytes_and_fields',
        ],
        { env: this.env },
      )

      const proof = new Uint8Array(await readFile(path.join(dir, 'proof')))
      const publicInputs = new Uint8Array(await readFile(path.join(dir, 'public_inputs')))
      const [c0, c1] = witness.commitments
      if (!c0 || !c1) throw new Error('proveHold: expected exactly 2 commitments')

      return {
        proof,
        publicInputs,
        claimed,
        commitmentsHex: [c0, c1],
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Off-chain check via `bb verify`, useful for sanity-checking a proof before spending a testnet tx. */
  async verifyLocally(proof: Uint8Array, publicInputs: Uint8Array): Promise<boolean> {
    await this.ensureVk()
    const dir = await mkdtemp(path.join(this.workDir, 'zktable-card-verify-'))
    try {
      const { writeFile } = await import('node:fs/promises')
      const proofPath = path.join(dir, 'proof')
      const publicInputsPath = path.join(dir, 'public_inputs')
      await writeFile(proofPath, proof)
      await writeFile(publicInputsPath, publicInputs)
      try {
        await execFileAsync(
          this.bbBin,
          [
            'verify',
            '--scheme',
            'ultra_honk',
            '--oracle_hash',
            'keccak',
            '--proof_path',
            proofPath,
            '--vk_path',
            this.vkPath,
            '--public_inputs_path',
            publicInputsPath,
          ],
          { env: this.env },
        )
        return true
      } catch {
        return false
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
}
