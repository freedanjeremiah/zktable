import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  CIRCUIT_PACKAGE_NAME,
  DEFAULT_BB_BIN,
  DEFAULT_CIRCUIT_DIR,
  DEFAULT_GRAPH_TOOLS_BIN,
  DEFAULT_NARGO_BIN,
  toolEnv,
} from './paths.js'
import type { BoardMove, BoardProof, GraphData } from './types.js'

const execFileAsync = promisify(execFile)

type WitnessJson = {
  root: string
  c_old: string
  c_new: string
  ticket: number
  edge_index: number
  public_inputs: string
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

export type BoardProverOptions = {
  circuitDir?: string
  graphToolsBin?: string
  nargoBin?: string
  bbBin?: string
  workDir?: string
}

/**
 * Orchestrates the full `board` module pipeline against real tools: writes
 * the graph, builds the witness via `zktable-graph`, executes the circuit
 * via `nargo`, and proves/verifies via `bb`. No mocks — every call produces
 * or checks a real UltraHonk proof.
 */
export class BoardProver {
  private readonly circuitDir: string
  private readonly graphToolsBin: string
  private readonly nargoBin: string
  private readonly bbBin: string
  private readonly workDir: string
  private readonly env: NodeJS.ProcessEnv

  constructor(opts: BoardProverOptions = {}) {
    this.circuitDir = opts.circuitDir ?? DEFAULT_CIRCUIT_DIR
    this.graphToolsBin = opts.graphToolsBin ?? DEFAULT_GRAPH_TOOLS_BIN
    this.nargoBin = opts.nargoBin ?? DEFAULT_NARGO_BIN
    this.bbBin = opts.bbBin ?? DEFAULT_BB_BIN
    this.workDir = opts.workDir ?? os.tmpdir()
    this.env = toolEnv()
  }

  private get targetDir(): string {
    return path.join(this.circuitDir, 'target')
  }

  private get bytecodePath(): string {
    return path.join(this.targetDir, `${CIRCUIT_PACKAGE_NAME}.json`)
  }

  private get vkPath(): string {
    return path.join(this.targetDir, 'vk')
  }

  /** Compile the circuit once if `target/move_along.json` is missing. */
  private async ensureCompiled(): Promise<void> {
    if (await exists(this.bytecodePath)) return
    await execFileAsync(this.nargoBin, ['compile'], { cwd: this.circuitDir, env: this.env })
  }

  /** Generate the verification key once if `target/vk` is missing. */
  private async ensureVk(): Promise<void> {
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
   * Full pipeline: write graph -> `zktable-graph witness` -> `nargo execute`
   * -> `bb prove`. Runs entirely inside an isolated temp dir; never touches
   * `move_along/Prover.toml` or `move_along/target/`.
   */
  async prove(graph: GraphData, move: BoardMove): Promise<BoardProof> {
    await this.ensureCompiled()

    const dir = await mkdtemp(path.join(this.workDir, 'zktable-prove-'))
    try {
      const graphPath = path.join(dir, 'graph.json')
      const proverTomlPath = path.join(dir, 'Prover')
      const witnessJsonPath = path.join(dir, 'witness.json')
      const witnessOutPath = path.join(dir, 'witness')

      await writeFile(graphPath, JSON.stringify(graph))

      await execFileAsync(
        this.graphToolsBin,
        [
          'witness',
          '--graph',
          graphPath,
          '--from',
          String(move.from),
          '--to',
          String(move.to),
          '--ticket',
          String(move.ticket),
          '--salt-old',
          move.saltOld.toString(),
          '--salt-new',
          move.saltNew.toString(),
          '--prover',
          `${proverTomlPath}.toml`,
          '--json',
          witnessJsonPath,
        ],
        { env: this.env },
      )

      const witness = JSON.parse(await readFile(witnessJsonPath, 'utf8')) as WitnessJson

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
        cOld: witness.c_old,
        cNew: witness.c_new,
        root: witness.root,
        ticket: move.ticket,
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** Off-chain check via `bb verify`. */
  async verifyLocally(proof: BoardProof): Promise<boolean> {
    await this.ensureVk()

    const dir = await mkdtemp(path.join(this.workDir, 'zktable-verify-'))
    try {
      const proofPath = path.join(dir, 'proof')
      const publicInputsPath = path.join(dir, 'public_inputs')
      await writeFile(proofPath, proof.proof)
      await writeFile(publicInputsPath, proof.publicInputs)

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
