// `CliRefereeClient` — a typed TS wrapper over the `stellar contract
// deploy`/`invoke` command sequence for the `liars-dice-referee` contract.
// Mirrors `games/blackout/src/referee-client.ts` exactly: shells out to the
// `stellar` CLI rather than reimplementing Soroban RPC.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_STELLAR_BIN, toolEnv } from './paths.js'

const execFileAsync = promisify(execFile)

// Mirrors `packages/contracts/contracts/liars-dice-referee/src/lib.rs`'s
// `Error` enum, used only to make CLI failures readable — never parsed
// programmatically.
const REFEREE_ERROR_NAMES: Record<number, string> = {
  1: 'AlreadyInitialized',
  2: 'UnsupportedConfig',
  3: 'BadPlayerIndex',
  4: 'WrongPhase',
  5: 'AlreadyCommitted',
  6: 'NonceRevealMismatch',
  7: 'AlreadyNonceRevealed',
  8: 'AlreadyRolled',
  9: 'VerificationFailed',
  10: 'ProofSizeMismatch',
  11: 'BadArrayLength',
  12: 'NotYourTurn',
  13: 'InvalidFace',
  14: 'BidDoesNotEscalate',
  15: 'NoCurrentBid',
  16: 'DiceRevealMismatch',
  17: 'AlreadyDiceRevealed',
  18: 'NotAlive',
  19: 'NotFullyCommitted',
}

export class RefereeCliError extends Error {
  readonly args: string[]
  readonly stderr: string
  readonly contractErrorCode: number | null
  readonly contractErrorName: string | null

  constructor(args: string[], stderr: string) {
    const match = /Error\(Contract, #(\d+)\)/.exec(stderr)
    const code = match ? Number(match[1]) : null
    const name = code !== null ? (REFEREE_ERROR_NAMES[code] ?? null) : null
    const suffix = code !== null ? ` -> Error(Contract, #${code})${name ? ` (${name})` : ''}` : ''
    super(`stellar ${args.join(' ')} failed${suffix}\n${stderr.trim()}`)
    this.name = 'RefereeCliError'
    this.args = args
    this.stderr = stderr
    this.contractErrorCode = code
    this.contractErrorName = name
  }
}

export type Phase = 'CommitNonce' | 'RevealNonce' | 'Roll' | 'Bid' | 'Reveal' | 'Finished'

export type ChainBid = { player: number; quantity: number; face: number }

export type ChainPlayer = {
  committed: boolean
  nonce_revealed: boolean
  rolled: boolean
  dice_commitments: string[]
  revealed_dice: number[]
  alive: boolean
}

export type ChainGameState = {
  phase: Phase
  n_players: number
  dice_per_player: number
  sides: number
  seed: string | null
  players: ChainPlayer[]
  bid_history: ChainBid[]
  current_bid: ChainBid[] // 0 or 1 elements — matches the contract's `Vec<Bid>` representation
  challenger: number | null
  turn: number
  outcome: number | null
}

export type CliRefereeClientOptions = {
  network?: string
  source?: string
  stellarBin?: string
  /** Bounded retry for transient (non-contract) CLI/network failures. */
  retries?: number
  retryDelayMs?: number
}

/** Strips a leading `0x` from a hex string (Bytes/BytesN CLI args are hex WITHOUT `0x`). */
export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

/** Big-endian 32-byte hex encoding of a non-negative bigint (no `0x` prefix). */
export function toBe32Hex(value: bigint): string {
  if (value < 0n) throw new Error('toBe32Hex: value must be non-negative')
  const hex = value.toString(16)
  if (hex.length > 64) throw new Error('toBe32Hex: value does not fit in 32 bytes')
  return hex.padStart(64, '0')
}

export class CliRefereeClient {
  private readonly network: string
  private readonly source: string
  private readonly stellarBin: string
  private readonly retries: number
  private readonly retryDelayMs: number

  constructor(opts: CliRefereeClientOptions = {}) {
    this.network = opts.network ?? 'testnet'
    this.source = opts.source ?? 'alice'
    this.stellarBin = opts.stellarBin ?? DEFAULT_STELLAR_BIN
    this.retries = opts.retries ?? 3
    this.retryDelayMs = opts.retryDelayMs ?? 3_000
  }

  /** `stellar contract deploy` for the `dice_valid` verifier. Returns the deployed contract id. */
  async deployVerifier(wasmPath: string, vkHex: string): Promise<string> {
    const stdout = await this.runDeploy(wasmPath, ['--vk_bytes', stripHexPrefix(vkHex)])
    return stdout.trim()
  }

  /** `stellar contract deploy` for the liars-dice referee. Returns the deployed contract id. */
  async deployReferee(
    wasmPath: string,
    opts: { verifier: string; nPlayers: number; dicePerPlayer: number; sides: number },
  ): Promise<string> {
    const stdout = await this.runDeploy(wasmPath, [
      '--verifier',
      opts.verifier,
      '--n_players',
      String(opts.nPlayers),
      '--dice_per_player',
      String(opts.dicePerPlayer),
      '--sides',
      String(opts.sides),
    ])
    return stdout.trim()
  }

  async commitNonce(refereeId: string, opts: { player: number; commitmentHex: string }): Promise<void> {
    await this.invoke(refereeId, [
      'commit_nonce',
      '--player',
      String(opts.player),
      '--nonce_commitment',
      stripHexPrefix(opts.commitmentHex),
    ])
  }

  async revealNonce(refereeId: string, opts: { player: number; nonceHex: string }): Promise<void> {
    await this.invoke(refereeId, [
      'reveal_nonce',
      '--player',
      String(opts.player),
      '--nonce',
      stripHexPrefix(opts.nonceHex),
    ])
  }

  async submitDice(
    refereeId: string,
    opts: { player: number; commitmentsHex: string[]; proofHex: string },
  ): Promise<void> {
    await this.invoke(refereeId, [
      'submit_dice',
      '--player',
      String(opts.player),
      '--commitments',
      JSON.stringify(opts.commitmentsHex.map(stripHexPrefix)),
      '--proof',
      stripHexPrefix(opts.proofHex),
    ])
  }

  async bid(refereeId: string, opts: { player: number; quantity: number; face: number }): Promise<void> {
    await this.invoke(refereeId, [
      'bid',
      '--player',
      String(opts.player),
      '--quantity',
      String(opts.quantity),
      '--face',
      String(opts.face),
    ])
  }

  async challenge(refereeId: string, opts: { player: number }): Promise<void> {
    await this.invoke(refereeId, ['challenge', '--player', String(opts.player)])
  }

  async revealDice(refereeId: string, opts: { player: number; dice: number[]; saltsHex: string[] }): Promise<void> {
    await this.invoke(refereeId, [
      'reveal_dice',
      '--player',
      String(opts.player),
      '--dice',
      JSON.stringify(opts.dice),
      '--salts',
      JSON.stringify(opts.saltsHex.map(stripHexPrefix)),
    ])
  }

  async gameState(refereeId: string): Promise<ChainGameState> {
    const stdout = await this.runReadOnly(refereeId, ['game_state'])
    return JSON.parse(stdout.trim()) as ChainGameState
  }

  // --- internals -----------------------------------------------------------

  private async runDeploy(wasmPath: string, ctorArgs: string[]): Promise<string> {
    const args = [
      'contract',
      'deploy',
      '--wasm',
      wasmPath,
      '--source',
      this.source,
      '--network',
      this.network,
      '--',
      ...ctorArgs,
    ]
    return this.execWithRetry(args)
  }

  /** Mutating call (`--send=yes`). */
  private async invoke(contractId: string, methodArgs: string[]): Promise<string> {
    const args = [
      'contract',
      'invoke',
      '--id',
      contractId,
      '--source',
      this.source,
      '--network',
      this.network,
      '--send=yes',
      '--',
      ...methodArgs,
    ]
    return this.execWithRetry(args)
  }

  /** Read-only call (no `--send`). */
  private async runReadOnly(contractId: string, methodArgs: string[]): Promise<string> {
    const args = [
      'contract',
      'invoke',
      '--id',
      contractId,
      '--source',
      this.source,
      '--network',
      this.network,
      '--',
      ...methodArgs,
    ]
    return this.execWithRetry(args)
  }

  private async execWithRetry(args: string[]): Promise<string> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const { stdout } = await execFileAsync(this.stellarBin, args, {
          env: toolEnv(),
          maxBuffer: 32 * 1024 * 1024,
        })
        return stdout
      } catch (err) {
        const stderr = typeof err === 'object' && err !== null && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : String(err)
        const cliError = new RefereeCliError(args, stderr)
        lastError = cliError
        // Deterministic contract errors (e.g. NotYourTurn, VerificationFailed)
        // will never succeed on retry — fail fast. Anything else (RPC
        // hiccups, sequence-number races, timeouts) gets a bounded retry.
        if (cliError.contractErrorCode !== null || attempt === this.retries) {
          throw cliError
        }
        await sleep(this.retryDelayMs * (attempt + 1))
      }
    }
    throw lastError
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
