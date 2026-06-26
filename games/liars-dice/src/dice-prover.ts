// `DiceProver` — orchestrates the full `dice_valid` pipeline against REAL
// tools (mirrors `@zktable/circuits`'s `BoardProver`, which this package
// intentionally does NOT import/modify — `dice_valid` is this milestone's
// new circuit and `@zktable/circuits` is another package's source): writes
// the witness via `zktable-graph dice-witness`, executes the circuit via
// `nargo`, and proves via `bb`. No mocks — every call produces a real
// UltraHonk proof over a real seed-derived roll.

import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  DEFAULT_BB_BIN,
  DEFAULT_NARGO_BIN,
  DICE_VALID_CIRCUIT_DIR,
  GRAPH_TOOLS_BIN,
  toolEnv,
} from './paths.js'

const execFileAsync = promisify(execFile)

type DiceWitnessJson = {
  seed: string
  player_id: string
  dice: string[]
  commitments: string[]
  public_inputs: string
}

export type DiceProof = {
  proof: Uint8Array
  publicInputs: Uint8Array
  /** The REAL seed-derived dice values (decimal), in circuit order (die 0..4). */
  dice: number[]
  /** Per-die commitments `hash2(die, salt)` (hex, `0x`-prefixed), matching `dice`'s order. */
  commitmentsHex: string[]
  seedHex: string
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export type DiceProverOptions = {
  circuitDir?: string
  graphToolsBin?: string
  nargoBin?: string
  bbBin?: string
  workDir?: string
}

export class DiceProver {
  private readonly circuitDir: string
  private readonly graphToolsBin: string
  private readonly nargoBin: string
  private readonly bbBin: string
  private readonly workDir: string
  private readonly env: NodeJS.ProcessEnv

  constructor(opts: DiceProverOptions = {}) {
    this.circuitDir = opts.circuitDir ?? DICE_VALID_CIRCUIT_DIR
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
    return path.join(this.targetDir, 'dice_valid.json')
  }
  private get vkPath(): string {
    return path.join(this.targetDir, 'vk')
  }

  /** Compile the circuit once if `target/dice_valid.json` is missing. */
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

  /** `zktable-graph seed --nonces ...` — the joint seed (hex), a public left-fold anyone can recompute. */
  async seed(nonces: bigint[]): Promise<string> {
    const { stdout } = await execFileAsync(this.graphToolsBin, ['seed', '--nonces', nonces.join(',')], {
      env: this.env,
    })
    return stdout.trim()
  }

  /** `zktable-graph commit --value V --salt S` — `Poseidon2(value, salt)` (hex). Used for `hash2(nonce, 0)` commitments. */
  async commit(value: bigint, salt: bigint): Promise<string> {
    const { stdout } = await execFileAsync(
      this.graphToolsBin,
      ['commit', '--value', value.toString(), '--salt', salt.toString()],
      { env: this.env },
    )
    return stdout.trim()
  }

  /**
   * Full pipeline for one player's roll: `zktable-graph dice-witness` ->
   * `nargo execute` -> `bb prove`. Runs entirely inside an isolated temp
   * dir; never touches `dice_valid/Prover.toml` or `dice_valid/target/`
   * (besides the shared, idempotent compiled bytecode).
   */
  async proveDice(seedHex: string, player: number, salts: bigint[]): Promise<DiceProof> {
    await this.ensureCompiled()

    const dir = await mkdtemp(path.join(this.workDir, 'zktable-dice-prove-'))
    try {
      const proverTomlPath = path.join(dir, 'Prover')
      const witnessJsonPath = path.join(dir, 'witness.json')
      const witnessOutPath = path.join(dir, 'witness')

      await execFileAsync(
        this.graphToolsBin,
        [
          'dice-witness',
          '--seed',
          seedHex,
          '--player',
          String(player),
          '--salts',
          salts.join(','),
          '--prover',
          `${proverTomlPath}.toml`,
          '--json',
          witnessJsonPath,
        ],
        { env: this.env },
      )

      const witness = JSON.parse(await readFile(witnessJsonPath, 'utf8')) as DiceWitnessJson

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

      return {
        proof,
        publicInputs,
        dice: witness.dice.map(Number),
        commitmentsHex: witness.commitments,
        seedHex: witness.seed,
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Off-chain check via `bb verify`, useful for sanity-checking a proof before spending a testnet tx. */
  async verifyLocally(proof: Uint8Array, publicInputs: Uint8Array): Promise<boolean> {
    await this.ensureVk()
    const dir = await mkdtemp(path.join(this.workDir, 'zktable-dice-verify-'))
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
