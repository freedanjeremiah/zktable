// The Blackout orchestrator: local match mirroring (used by both the fast
// local tests and the on-chain runner below) and `playBlackout`, which plays
// a COMPLETE game on live Stellar testnet with every Phantom move ZK-verified
// by the on-chain referee.

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { BoardGraph, BoardProver } from '@zktable/circuits'
import { createMatch } from '@zktable/core'
import type { Match, PlayerId } from '@zktable/core'
import {
  DEFAULT_N_ROUNDS,
  DEFAULT_REVEAL_ROUNDS,
  DEFAULT_TICKETS,
  blackout,
} from './blackout.js'
import type { BlackoutConfig, TicketCounts } from './blackout.js'
import { cityGraph, cityGraphData } from './map.js'
import {
  DEFAULT_REFEREE_WASM,
  DEFAULT_VERIFIER_WASM,
  DEFAULT_VK_PATH,
  MOVE_ALONG_CIRCUIT_DIR,
  toolEnv,
} from './paths.js'
import { CliRefereeClient, toBe32Hex } from './referee-client.js'
import type { ChainGameState } from './referee-client.js'
import { investigatorMove, phantomMove } from './strategy.js'

const PHANTOM_ID = 'phantom'

export function investigatorId(index: number): PlayerId {
  return `investigator${index + 1}`
}

export type Roster = Array<{ id: PlayerId; role: 'phantom' | 'investigator' }>

export function buildRoster(investigatorCount: number): Roster {
  const roster: Roster = [{ id: PHANTOM_ID, role: 'phantom' }]
  for (let i = 0; i < investigatorCount; i++) roster.push({ id: investigatorId(i), role: 'investigator' })
  return roster
}

/** Creates a local `Match` mirroring what the on-chain referee will enforce. */
export function createLocalMatch(roster: Roster, config: BlackoutConfig, seed: string): Match {
  return createMatch(blackout, roster, { seed, config: { blackout: config } })
}

export type LocalStep = { playerId: PlayerId; role: string; move: { to: number; ticket: number } }

/**
 * Advances the local match by exactly one move using the seeded strategies,
 * and — for the Phantom — updates the locally-held secret via
 * `Match.setSecret` (the `@zktable/core` addition this milestone adds),
 * since `apply` is pure over public `MatchState` and cannot touch it itself.
 */
export function stepLocalMatch(match: Match, seed: string): LocalStep {
  const playerId = match.state.turn.current
  const view = match.view(playerId)
  const role = view.self.role!
  const moveSeed = `${seed}:r${match.state.turn.round}:${playerId}`
  const move = role === 'phantom' ? phantomMove(view, cityGraph, moveSeed) : investigatorMove(view, cityGraph, moveSeed)
  match.submit(playerId, move)
  if (role === 'phantom') {
    match.setSecret(playerId, { pos: move.to })
  }
  return { playerId, role, move: { to: move.to as number, ticket: move.ticket as number } }
}

/** Plays a full LOCAL game (no chain) to a natural end, guarded against runaway loops. */
export function playLocalMatch(
  roster: Roster,
  config: BlackoutConfig,
  seed: string,
  opts: { maxSteps?: number } = {},
): { match: Match; steps: LocalStep[] } {
  const match = createLocalMatch(roster, config, seed)
  const steps: LocalStep[] = []
  const maxSteps = opts.maxSteps ?? 2000
  while (match.state.status === 'active' && steps.length < maxSteps) {
    steps.push(stepLocalMatch(match, seed))
  }
  if (match.state.status === 'active') {
    throw new Error(`playLocalMatch: did not reach a natural end within ${maxSteps} steps`)
  }
  return { match, steps }
}

// --- on-chain orchestration ------------------------------------------------

export type PlayBlackoutOptions = {
  network?: string
  source?: string
  investigatorCount?: number
  nRounds?: number
  revealRounds?: number[]
  seed?: string
  tickets?: TicketCounts
  startPositions?: Record<PlayerId, number>
  verifierWasmPath?: string
  refereeWasmPath?: string
  vkPath?: string
  /**
   * Scripted-scenario capture (documented, orchestrator-driven — not an AI
   * decision): at this reveal round, position `investigatorIndex` exactly
   * onto the Phantom's real (about-to-be-revealed) node before the reveal,
   * guaranteeing a capture so the on-chain acceptance run finishes in
   * minutes rather than a full 24-round game. Adjacency is NOT checked
   * on-chain for `submit_public_move` (v1 simplification — PRD §12.2), so
   * this is a legal contract call; it is simply not something the
   * `investigatorMove` heuristic would discover on its own.
   */
  scriptedCapture?: { round: number; investigatorIndex: number }
  log?: (line: string) => void
}

export type Transcript = {
  verifierContractId: string
  refereeContractId: string
  roster: Roster
  startPositions: Record<PlayerId, number>
  moves: Array<
    | { kind: 'hidden'; round: number; player: PlayerId; playerIndex: number; to: number; ticket: number; txOk: true }
    | { kind: 'public'; round: number; player: PlayerId; playerIndex: number; to: number; ticket: number; txOk: true }
    | { kind: 'reveal'; round: number; player: PlayerId; node: number; scripted: boolean }
  >
  finalState: ChainGameState
  outcome: 'phantom' | 'investigator' | null
}

/**
 * Compiles the `move_along` circuit and writes its verification key if
 * missing. Exported (alongside `ensureContractWasms`/`randomSalt`/
 * `addressOf` below) so a stateful, per-match orchestrator (e.g. the M4b web
 * API) can reuse the exact same build/tooling path `playBlackout` uses,
 * rather than re-shelling to `nargo`/`bb` itself.
 */
export async function ensureVk(log: (line: string) => void, vkPath: string): Promise<void> {
  const { access } = await import('node:fs/promises')
  try {
    await access(vkPath)
    return
  } catch {
    // fall through to build
  }
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const env = toolEnv()

  log('building move_along circuit (nargo compile)…')
  await execFileAsync('nargo', ['compile'], { cwd: MOVE_ALONG_CIRCUIT_DIR, env })

  log('generating move_along verification key (bb write_vk)…')
  await execFileAsync(
    'bb',
    [
      'write_vk',
      '--scheme',
      'ultra_honk',
      '--oracle_hash',
      'keccak',
      '--bytecode_path',
      `${MOVE_ALONG_CIRCUIT_DIR}/target/move_along.json`,
      '--output_path',
      `${MOVE_ALONG_CIRCUIT_DIR}/target`,
      '--output_format',
      'bytes_and_fields',
    ],
    { env },
  )
}

/** Builds the verifier/referee contract wasms if missing. See `ensureVk` for why this is exported. */
export async function ensureContractWasms(log: (line: string) => void): Promise<void> {
  const { access } = await import('node:fs/promises')
  const missing: string[] = []
  for (const p of [DEFAULT_VERIFIER_WASM, DEFAULT_REFEREE_WASM]) {
    try {
      await access(p)
    } catch {
      missing.push(p)
    }
  }
  if (missing.length === 0) return
  log(`building contract wasms (missing: ${missing.join(', ')})…`)
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { CONTRACTS_DIR } = await import('./paths.js')
  await execFileAsync(
    'cargo',
    ['+stable', 'build', '--release', '--target', 'wasm32v1-none', '-p', 'zktable-verifier', '-p', 'zktable-referee'],
    { cwd: CONTRACTS_DIR, env: toolEnv() },
  )
}

/** A random bigint in [1, 2^128), used as a movement salt. Exported — see `ensureVk`. */
export function randomSalt(): bigint {
  return BigInt('0x' + randomBytes(16).toString('hex')) + 1n
}

/**
 * Plays a COMPLETE game of Blackout on live Stellar testnet: deploys the
 * `move_along` verifier and the referee, joins 1 Phantom + N Investigators,
 * sets starting positions, and drives the game round by round — every
 * Phantom move is a REAL UltraHonk proof, verified on-chain by
 * `submit_hidden_move`. Returns a full transcript.
 */
export async function playBlackout(opts: PlayBlackoutOptions = {}): Promise<Transcript> {
  const log = opts.log ?? ((line: string) => console.log(line))
  const investigatorCount = opts.investigatorCount ?? 2
  const nRounds = opts.nRounds ?? DEFAULT_N_ROUNDS
  const revealRounds = opts.revealRounds ?? DEFAULT_REVEAL_ROUNDS
  const seed = opts.seed ?? `blackout-testnet-${Date.now()}`
  const tickets = opts.tickets ?? DEFAULT_TICKETS
  const roster = buildRoster(investigatorCount)

  const startPositions =
    opts.startPositions ??
    Object.fromEntries(
      roster.map((p, i) => [p.id, p.role === 'phantom' ? 1 : 10 * (i + 4)]),
    )

  await ensureContractWasms(log)
  await ensureVk(log, opts.vkPath ?? DEFAULT_VK_PATH)

  const graph = new BoardGraph(cityGraphData)
  const prover = new BoardProver()
  const client = new CliRefereeClient({ network: opts.network, source: opts.source })

  log('computing graph root…')
  const graphRootHex = await graph.root()

  log('reading move_along verification key…')
  const vkHex = (await readFile(opts.vkPath ?? DEFAULT_VK_PATH)).toString('hex')

  log('deploying move_along verifier…')
  const verifierContractId = await client.deployVerifier(opts.verifierWasmPath ?? DEFAULT_VERIFIER_WASM, vkHex)
  log(`  verifier: ${verifierContractId}`)

  log('deploying referee…')
  const refereeContractId = await client.deployReferee(opts.refereeWasmPath ?? DEFAULT_REFEREE_WASM, {
    verifier: verifierContractId,
    graphRootHex,
    nRounds,
    revealRounds,
  })
  log(`  referee: ${refereeContractId}`)

  const source = opts.source ?? 'alice'
  const addr = await addressOf(source)

  const playerIndex = new Map<PlayerId, number>()
  for (const p of roster) {
    log(`joining ${p.id} (${p.role})…`)
    const idx = await client.join(refereeContractId, {
      addr,
      role: p.role,
      ticketTaxi: tickets.taxi,
      ticketBus: tickets.bus,
      ticketRail: tickets.rail,
    })
    playerIndex.set(p.id, idx)
  }

  // Phantom's local (pos, salt) — the only thing besides the local Match's
  // secret that must be tracked to build the next hidden-move proof.
  let phantomSalt = randomSalt()
  const phantomStart = startPositions[PHANTOM_ID]!
  const initialCommitment = await graph.commit(phantomStart, phantomSalt)

  log(`setting Phantom hidden start (node ${phantomStart})…`)
  await client.setHiddenStart(refereeContractId, playerIndex.get(PHANTOM_ID)!, initialCommitment)

  for (const p of roster) {
    if (p.role !== 'investigator') continue
    const node = startPositions[p.id]!
    log(`setting ${p.id} public start (node ${node})…`)
    await client.setPublicStart(refereeContractId, playerIndex.get(p.id)!, node)
  }

  log('starting the match…')
  await client.start(refereeContractId)

  const config: BlackoutConfig = { startPositions, tickets: rosterTickets(roster, tickets), nRounds, revealRounds }
  const localMatch = createLocalMatch(roster, config, seed)

  const moves: Transcript['moves'] = []
  let phantomPos = phantomStart
  let state = await client.gameState(refereeContractId)

  while (state.status === 'Active') {
    const currentIdx = state.current_player
    const currentEntry = [...playerIndex.entries()].find(([, idx]) => idx === currentIdx)
    if (!currentEntry) throw new Error(`playBlackout: unknown current_player index ${currentIdx}`)
    const [currentId, idx] = currentEntry
    const round = state.round

    const { move } = stepLocalMatch(localMatch, seed)

    if (currentId === PHANTOM_ID) {
      const newSalt = randomSalt()
      log(`round ${round}: Phantom proving move ${phantomPos} -> ${move.to} (ticket ${move.ticket})…`)
      const proof = await prover.prove(cityGraphData, {
        from: phantomPos,
        to: move.to,
        ticket: move.ticket as 0 | 1 | 2,
        saltOld: phantomSalt,
        saltNew: newSalt,
      })
      log('  submitting submit_hidden_move (ZK-verified on-chain)…')
      await client.submitHiddenMove(refereeContractId, {
        player: idx,
        cNewHex: proof.cNew,
        ticket: move.ticket,
        proofHex: Buffer.from(proof.proof).toString('hex'),
      })
      phantomPos = move.to
      phantomSalt = newSalt
      moves.push({ kind: 'hidden', round, player: currentId, playerIndex: idx, to: move.to, ticket: move.ticket, txOk: true })

      if (revealRounds.includes(round)) {
        const scripted = opts.scriptedCapture?.round === round
        if (scripted) {
          const investigatorEntry = roster.filter((p) => p.role === 'investigator')[opts.scriptedCapture!.investigatorIndex]
          if (!investigatorEntry) throw new Error('playBlackout: scriptedCapture.investigatorIndex out of range')
          const invIdx = playerIndex.get(investigatorEntry.id)!
          log(`  [scripted] positioning ${investigatorEntry.id} onto Phantom's revealed node ${phantomPos} before reveal…`)
          await client.submitPublicMove(refereeContractId, { player: invIdx, node: phantomPos, ticket: 0 })
          moves.push({ kind: 'public', round, player: investigatorEntry.id, playerIndex: invIdx, to: phantomPos, ticket: 0, txOk: true })
        }
        log(`  round ${round} is a reveal round: revealing node ${phantomPos}…`)
        await client.reveal(refereeContractId, { player: idx, node: phantomPos, saltHex: toBe32Hex(phantomSalt) })
        moves.push({ kind: 'reveal', round, player: currentId, node: phantomPos, scripted })
      }
    } else {
      log(`round ${round}: ${currentId} moving -> ${move.to} (ticket ${move.ticket})…`)
      await client.submitPublicMove(refereeContractId, { player: idx, node: move.to, ticket: move.ticket })
      moves.push({ kind: 'public', round, player: currentId, playerIndex: idx, to: move.to, ticket: move.ticket, txOk: true })
    }

    state = await client.gameState(refereeContractId)
  }

  log(`game finished: ${state.outcome}`)
  return {
    verifierContractId,
    refereeContractId,
    roster,
    startPositions,
    moves,
    finalState: state,
    outcome: state.outcome,
  }
}

/** Same ticket wallet for every roster member. Exported — see `ensureVk`. */
export function rosterTickets(roster: Roster, tickets: TicketCounts): Record<PlayerId, TicketCounts> {
  return Object.fromEntries(roster.map((p) => [p.id, tickets]))
}

/** Resolves a `stellar` CLI identity name (e.g. `'alice'`) to its address. Exported — see `ensureVk`. */
export async function addressOf(source: string): Promise<string> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { stdout } = await execFileAsync('stellar', ['keys', 'address', source], { env: toolEnv() })
  return stdout.trim()
}
