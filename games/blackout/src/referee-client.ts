// `CliRefereeClient` — a typed TS wrapper over the exact `stellar contract
// deploy`/`invoke` command sequence proven to work against the deployed
// `zktable-referee`/`zktable-verifier` contracts on Stellar testnet (see
// packages/contracts's M2 milestone). Shells out to the `stellar` CLI rather
// than reimplementing Soroban RPC — the CLI is the tool that was actually
// used to prove the referee end to end.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_STELLAR_BIN, toolEnv } from './paths.js'

const execFileAsync = promisify(execFile)

// Mirrors `packages/contracts/contracts/referee/src/lib.rs`'s `Error` enum,
// used only to make CLI failures readable — never parsed programmatically.
const REFEREE_ERROR_NAMES: Record<number, string> = {
  1: 'AlreadyInitialized',
  2: 'NotLobbyPhase',
  3: 'NotActive',
  4: 'NotYourTurn',
  5: 'WrongRole',
  6: 'NoTicket',
  7: 'VerificationFailed',
  8: 'RevealMismatch',
  9: 'BadPlayerIndex',
  10: 'NoStartPosition',
  11: 'InvalidRole',
  12: 'InvalidTicket',
  13: 'InvalidRoster',
  14: 'NotRevealRound',
  15: 'ProofSizeMismatch',
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

export type Role = 'phantom' | 'investigator'
export type GameStatus = 'Lobby' | 'Active' | 'Finished'

export type ChainPlayer = {
  address: string
  role: Role
  public_node: number | null
  hidden_commitment: string | null
  resources: [number, number, number]
}

export type ChainGameState = {
  status: GameStatus
  round: number
  turn_index: number
  current_player: number
  ticket_feed: number[]
  reveal_log: [number, number][]
  players: ChainPlayer[]
  outcome: Role | null
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
   * owner's signature. Deploys/`join`/`start` always use `source`.
   */
  sourceForSeat?: Record<number, string>
}

/** Strips a leading `0x` from a hex string (Bytes/BytesN CLI args are hex WITHOUT `0x`). */
export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex
}

/** Big-endian 32-byte hex encoding of a non-negative bigint (no `0x` prefix), for reveal salts. */
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

  /** `stellar contract deploy` for the `move_along` verifier. Returns the deployed contract id. */
  async deployVerifier(wasmPath: string, vkHex: string): Promise<string> {
    const stdout = await this.runDeploy(wasmPath, ['--vk-bytes', stripHexPrefix(vkHex)])
    return stdout.trim()
  }

  /** `stellar contract deploy` for the referee. Returns the deployed contract id. */
  async deployReferee(
    wasmPath: string,
    opts: { verifier: string; graphRootHex: string; nRounds: number; revealRounds: number[] },
  ): Promise<string> {
    const stdout = await this.runDeploy(wasmPath, [
      '--verifier',
      opts.verifier,
      '--graph-root',
      stripHexPrefix(opts.graphRootHex),
      '--n-rounds',
      String(opts.nRounds),
      '--reveal-rounds',
      JSON.stringify(opts.revealRounds),
    ])
    return stdout.trim()
  }

  async join(
    refereeId: string,
    opts: { addr: string; role: Role; ticketTaxi: number; ticketBus: number; ticketRail: number },
  ): Promise<number> {
    const stdout = await this.invoke(refereeId, [
      'join',
      '--addr',
      opts.addr,
      '--role',
      opts.role,
      '--ticket-taxi',
      String(opts.ticketTaxi),
      '--ticket-bus',
      String(opts.ticketBus),
      '--ticket-rail',
      String(opts.ticketRail),
    ])
    return Number(stdout.trim())
  }

  async setHiddenStart(refereeId: string, player: number, commitmentHex: string): Promise<void> {
    await this.invoke(
      refereeId,
      ['set_hidden_start', '--player', String(player), '--commitment', stripHexPrefix(commitmentHex)],
      player,
    )
  }

  async setPublicStart(refereeId: string, player: number, node: number): Promise<void> {
    await this.invoke(
      refereeId,
      ['set_public_start', '--player', String(player), '--node', String(node)],
      player,
    )
  }

  async start(refereeId: string): Promise<void> {
    await this.invoke(refereeId, ['start'])
  }

  async submitHiddenMove(
    refereeId: string,
    opts: { player: number; cNewHex: string; ticket: number; proofHex: string },
  ): Promise<void> {
    await this.invoke(
      refereeId,
      [
        'submit_hidden_move',
        '--player',
        String(opts.player),
        '--c-new',
        stripHexPrefix(opts.cNewHex),
        '--ticket',
        String(opts.ticket),
        '--proof',
        stripHexPrefix(opts.proofHex),
      ],
      opts.player,
    )
  }

  async submitPublicMove(refereeId: string, opts: { player: number; node: number; ticket: number }): Promise<void> {
    await this.invoke(
      refereeId,
      [
        'submit_public_move',
        '--player',
        String(opts.player),
        '--node',
        String(opts.node),
        '--ticket',
        String(opts.ticket),
      ],
      opts.player,
    )
  }

  async reveal(refereeId: string, opts: { player: number; node: number; saltHex: string }): Promise<void> {
    await this.invoke(
      refereeId,
      [
        'reveal',
        '--player',
        String(opts.player),
        '--node',
        String(opts.node),
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
