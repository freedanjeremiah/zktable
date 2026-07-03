// `CardProver` - orchestrates the full `card_membership` + `valid_shuffle`
// pipelines against REAL tools (mirrors `games/liars-dice/src/dice-prover.ts`'s
// shape, which itself mirrors `@zktable/circuits`'s `BoardProver`): writes
// witnesses via `zktable-graph card-witness`/`shuffle-witness`, executes the
// circuits via `nargo`, and proves via `bb`. No mocks - every call produces a
// real UltraHonk proof.
//
// PROVABLY FAIR DEAL (M8.3, deck v1.5 - see `coup-lite.ts`'s and the
// coup-referee's module docs): `proveShuffle` derives the UNIQUE seed-forced
// permutation of the canonical 15-card deck and proves it; hands are then
// fixed deck positions, so the dealer cannot choose the deal - only learn it
// (dealer card-privacy is deck v2 / mental-poker territory). `proveHold`
// remains the load-bearing in-play ZK: it proves a claimed character is
// genuinely in a player's committed hand without revealing which card, or
// the other card's identity.

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
  VALID_SHUFFLE_CIRCUIT_DIR,
  toolEnv,
} from './paths.js'

const execFileAsync = promisify(execFile)

type CardWitnessJson = {
  claimed_card: string
  held_index: number
  cards: string[]
  commitments: string[]
  public_inputs: string
}

export type CardProof = {
  proof: Uint8Array
  publicInputs: Uint8Array
  claimed: bigint
  commitmentsHex: [string, string]
}

type ShuffleWitnessJson = {
  seed: string
  perm: number[]
  cards: string[]
  salts: string[]
  leaves: string[]
  public_inputs: string
}

/** The seed-forced shuffled deck plus its `valid_shuffle` proof (M8.3). */
export type ShuffleProof = {
  proof: Uint8Array
  publicInputs: Uint8Array
  seedHex: string
  /** Card value (0-4) at each of the 15 deck positions — dealer-visible only. */
  cards: number[]
  /** Salt (decimal string) at each deck position. */
  salts: string[]
  /** Poseidon2(card, salt) leaf commitment (hex) at each deck position. */
  leavesHex: string[]
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
  shuffleCircuitDir?: string
  graphToolsBin?: string
  nargoBin?: string
  bbBin?: string
  workDir?: string
}

export class CardProver {
  private readonly circuitDir: string
  private readonly shuffleCircuitDir: string
  private readonly graphToolsBin: string
  private readonly nargoBin: string
  private readonly bbBin: string
  private readonly workDir: string
  private readonly env: NodeJS.ProcessEnv

  constructor(opts: CardProverOptions = {}) {
    this.circuitDir = opts.circuitDir ?? CARD_MEMBERSHIP_CIRCUIT_DIR
    this.shuffleCircuitDir = opts.shuffleCircuitDir ?? VALID_SHUFFLE_CIRCUIT_DIR
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
  private get shuffleTargetDir(): string {
    return path.join(this.shuffleCircuitDir, 'target')
  }
  private get shuffleBytecodePath(): string {
    return path.join(this.shuffleTargetDir, 'valid_shuffle.json')
  }
  private get shuffleVkPath(): string {
    return path.join(this.shuffleTargetDir, 'vk')
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
    await this.writeVk(this.bytecodePath, this.targetDir)
  }

  /** Compile `valid_shuffle` once if its bytecode is missing. */
  async ensureShuffleCompiled(): Promise<void> {
    if (await exists(this.shuffleBytecodePath)) return
    await execFileAsync(this.nargoBin, ['compile'], { cwd: this.shuffleCircuitDir, env: this.env })
  }

  /** Generate the `valid_shuffle` verification key once if missing. */
  async ensureShuffleVk(): Promise<void> {
    await this.ensureShuffleCompiled()
    if (await exists(this.shuffleVkPath)) return
    await this.writeVk(this.shuffleBytecodePath, this.shuffleTargetDir)
  }

  private async writeVk(bytecodePath: string, outputDir: string): Promise<void> {
    await execFileAsync(
      this.bbBin,
      [
        'write_vk',
        '--scheme',
        'ultra_honk',
        '--oracle_hash',
        'keccak',
        '--bytecode_path',
        bytecodePath,
        '--output_path',
        outputDir,
        '--output_format',
        'bytes_and_fields',
      ],
      { env: this.env },
    )
    // bb sometimes writes `vk` as a directory containing a `vk` file —
    // normalize to a flat file (same fixup scripts/build_all.sh performs).
    const vkPath = path.join(outputDir, 'vk')
    const { stat, rename, rmdir } = await import('node:fs/promises')
    const s = await stat(vkPath)
    if (s.isDirectory()) {
      await rename(path.join(vkPath, 'vk'), `${vkPath}.tmp`)
      await rmdir(vkPath)
      await rename(`${vkPath}.tmp`, vkPath)
    }
  }

  /**
   * Poseidon2(value, salt) via `zktable-graph commit` — used for the seed
   * commit-reveal nonces (`hash2(nonce, 0)`), byte-identical to the referee.
   */
  async commit(value: bigint, salt: bigint): Promise<string> {
    const { stdout } = await execFileAsync(
      this.graphToolsBin,
      ['commit', '--value', value.toString(), '--salt', salt.toString()],
      { env: this.env },
    )
    return stdout.trim()
  }

  /** The joint commit-reveal seed: left-fold of hash2 over the nonces (player-index order). */
  async seed(nonces: bigint[]): Promise<string> {
    const { stdout } = await execFileAsync(
      this.graphToolsBin,
      ['seed', '--nonces', nonces.join(',')],
      { env: this.env },
    )
    return stdout.trim()
  }

  /**
   * Full `valid_shuffle` pipeline (M8.3): derive the UNIQUE seed-forced
   * permutation of the canonical 15-card deck via `zktable-graph
   * shuffle-witness`, then `nargo execute` -> `bb prove`. The returned
   * `cards`/`salts` are the dealer's private view (handed to each player
   * off-chain); `leavesHex` + `proof` go on-chain via `submit_shuffle`.
   */
  async proveShuffle(seedHex: string, salts: bigint[]): Promise<ShuffleProof> {
    if (salts.length !== 15) throw new Error('proveShuffle: exactly 15 salts required')
    await this.ensureShuffleCompiled()

    const dir = await mkdtemp(path.join(this.workDir, 'zktable-shuffle-prove-'))
    try {
      const proverTomlPath = path.join(dir, 'Prover')
      const witnessJsonPath = path.join(dir, 'witness.json')
      const witnessOutPath = path.join(dir, 'witness')

      await execFileAsync(
        this.graphToolsBin,
        [
          'shuffle-witness',
          '--seed',
          seedHex,
          '--salts',
          salts.join(','),
          '--prover',
          `${proverTomlPath}.toml`,
          '--json',
          witnessJsonPath,
        ],
        { env: this.env },
      )

      const witness = JSON.parse(await readFile(witnessJsonPath, 'utf8')) as ShuffleWitnessJson

      await execFileAsync(this.nargoBin, ['execute', '--prover-name', proverTomlPath, witnessOutPath], {
        cwd: this.shuffleCircuitDir,
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
          this.shuffleBytecodePath,
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
        seedHex: witness.seed,
        cards: witness.cards.map((c) => Number(c)),
        salts: witness.salts,
        leavesHex: witness.leaves,
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
    return this.bbVerify(proof, publicInputs, this.vkPath)
  }

  /** Off-chain `bb verify` of a `valid_shuffle` proof against ITS verification key. */
  async shuffleLocalVerify(proof: Uint8Array, publicInputs: Uint8Array): Promise<boolean> {
    await this.ensureShuffleVk()
    return this.bbVerify(proof, publicInputs, this.shuffleVkPath)
  }

  private async bbVerify(proof: Uint8Array, publicInputs: Uint8Array, vkPath: string): Promise<boolean> {
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
            vkPath,
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
