// `CliRefereeClient` - a typed TS wrapper over the `stellar contract
// deploy`/`invoke` command sequence for the `coup-referee` contract. Mirrors
// `games/liars-dice/src/referee-client.ts` exactly: shells out to the
// `stellar` CLI rather than reimplementing Soroban RPC.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_STELLAR_BIN, toolEnv } from './paths.js'

const execFileAsync = promisify(execFile)

// Mirrors `packages/contracts/contracts/coup-referee/src/lib.rs`'s `Error`
// enum, used only to make CLI failures readable - never parsed programmatically.
const REFEREE_ERROR_NAMES: Record<number, string> = {
  1: 'AlreadyInitialized',
  2: 'UnsupportedConfig',
  3: 'BadPlayerIndex',
  4: 'WrongPhase',
  5: 'AlreadyDealt',
  6: 'BadArrayLength',
  7: 'NotYourTurn',
  8: 'NotAlive',
  9: 'NoActiveClaim',
  10: 'ClaimTargetMismatch',
  11: 'CannotChallengeSelf',
  12: 'ClaimMismatch',
  13: 'VerificationFailed',
  14: 'ProofSizeMismatch',
  15: 'NotAuthorizedToReveal',
  16: 'SlotAlreadyRevealed',
  17: 'BadSlotIndex',
  18: 'CardRevealMismatch',
  19: 'AlreadyCommitted',
  20: 'NonceRevealMismatch',
  21: 'AlreadyNonceRevealed',
  22: 'NotFullyCommitted',
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

export type Phase =
  | 'SeedCommit'
  | 'SeedReveal'
  | 'Shuffle'
  | 'Playing'
  | 'AwaitingResponse'
  | 'AwaitingReveal'
  | 'Finished'

export type ChainPlayer = {
  seed_committed: boolean
  seed_revealed: boolean
  dealt: boolean
  commitments: string[]
  dead: boolean[]
  influence: number
  alive: boolean
}

export type ChainGameState = {
  phase: Phase
  n_players: number
  seed: string | null
  deck: string[]
  players: ChainPlayer[]
  turn: number
  last_claim_player: number | null
  last_claim_character: number | null
  challenger: number | null
  target: number | null
  pending_loser: number | null
  outcome: number | null
}

export type CliRefereeClientOptions = {
  network?: string
  source?: string
  stellarBin?: string
  /** Bounded retry for transient (non-contract) CLI/network failures. */
  retries?: number
  retryDelayMs?: number
  /**
   * CLI identity name per seat index. When a per-seat mutating call is made
   * for seat i, the transaction is signed by `sourceForSeat[i]` (falling
   * back to `source`) so the referee's `require_auth()` sees the seat
   * owner's signature. Deploys always use `source`.
   */
  sourceForSeat?: Record<number, string>
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
  private readonly sourceForSeat: Record<number, string>

  constructor(opts: CliRefereeClientOptions = {}) {
    this.network = opts.network ?? 'testnet'
    this.source = opts.source ?? 'alice'
    this.stellarBin = opts.stellarBin ?? DEFAULT_STELLAR_BIN
    this.retries = opts.retries ?? 3
    this.retryDelayMs = opts.retryDelayMs ?? 3_000
    this.sourceForSeat = opts.sourceForSeat ?? {}
  }

  /** `stellar contract deploy` for the `card_membership` verifier. Returns the deployed contract id. */
  async deployVerifier(wasmPath: string, vkHex: string): Promise<string> {
    const stdout = await this.runDeploy(wasmPath, ['--vk_bytes', stripHexPrefix(vkHex)])
    return stdout.trim()
  }

  /**
   * `stellar contract deploy` for the coup referee. Returns the deployed
   * contract id. `playerAddresses[i]` becomes seat i's owner — every seat-i
   * action must then be signed by that address (require_auth). `verifier`
   * holds the `card_membership` VK; `shuffleVerifier` the `valid_shuffle`
   * VK (M8.3).
   */
  async deployReferee(
    wasmPath: string,
    opts: { verifier: string; shuffleVerifier: string; playerAddresses: string[] },
  ): Promise<string> {
    const stdout = await this.runDeploy(wasmPath, [
      '--verifier',
      opts.verifier,
      '--shuffle_verifier',
      opts.shuffleVerifier,
      '--players',
      JSON.stringify(opts.playerAddresses),
    ])
    return stdout.trim()
  }

  async commitSeedNonce(refereeId: string, opts: { player: number; commitmentHex: string }): Promise<void> {
    await this.invoke(
      refereeId,
      ['commit_seed_nonce', '--player', String(opts.player), '--nonce_commitment', stripHexPrefix(opts.commitmentHex)],
      opts.player,
    )
  }

  async revealSeedNonce(refereeId: string, opts: { player: number; nonceHex: string }): Promise<void> {
    await this.invoke(
      refereeId,
      ['reveal_seed_nonce', '--player', String(opts.player), '--nonce', stripHexPrefix(opts.nonceHex)],
      opts.player,
    )
  }

  /** Submits the 15 shuffle-proven deck leaves + the `valid_shuffle` proof (permissionless — the proof is the trust anchor). */
  async submitShuffle(refereeId: string, opts: { leavesHex: string[]; proofHex: string }): Promise<void> {
    await this.invoke(refereeId, [
      'submit_shuffle',
      '--leaves',
      JSON.stringify(opts.leavesHex.map(stripHexPrefix)),
      '--proof',
      stripHexPrefix(opts.proofHex),
    ])
  }

  async claim(refereeId: string, opts: { player: number; character: number }): Promise<void> {
    await this.invoke(
      refereeId,
      ['claim', '--player', String(opts.player), '--character', String(opts.character)],
      opts.player,
    )
  }

  async challenge(refereeId: string, opts: { challenger: number; target: number }): Promise<void> {
    await this.invoke(
      refereeId,
      ['challenge', '--challenger', String(opts.challenger), '--target', String(opts.target)],
      opts.challenger,
    )
  }

  async proveHold(
    refereeId: string,
    opts: { target: number; claimed: number; proofHex: string },
  ): Promise<void> {
    await this.invoke(
      refereeId,
      [
        'prove_hold',
        '--target',
        String(opts.target),
        '--claimed',
        String(opts.claimed),
        '--proof',
        stripHexPrefix(opts.proofHex),
      ],
      opts.target,
    )
  }

  async revealCard(
    refereeId: string,
    opts: { player: number; slot: number; card: number; saltHex: string },
  ): Promise<void> {
    await this.invoke(
      refereeId,
      [
        'reveal_card',
        '--player',
        String(opts.player),
        '--slot',
        String(opts.slot),
        '--card',
        String(opts.card),
        '--salt',
        stripHexPrefix(opts.saltHex),
      ],
      opts.player,
    )
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

  /**
   * Mutating call (`--send=yes`). When `seat` is given, signs with that
   * seat's identity (`sourceForSeat[seat]`, falling back to `source`) so
   * the referee's per-seat `require_auth()` is satisfied.
   */
  private async invoke(contractId: string, methodArgs: string[], seat?: number): Promise<string> {
    const source = seat !== undefined ? (this.sourceForSeat[seat] ?? this.source) : this.source
    const args = [
      'contract',
      'invoke',
      '--id',
      contractId,
      '--source',
      source,
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
        // will never succeed on retry - fail fast. Anything else (RPC
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
