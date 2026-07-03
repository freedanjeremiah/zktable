// The Liar's Dice orchestrator: local match mirroring (used by both the fast
// local tests and the on-chain runner below) and `playLiarsDice`, which
// plays a COMPLETE game on live Stellar testnet — real sealed commit-reveal
// seed, real `dice_valid` proofs per player, real bids/challenge/reveal, a
// real on-chain outcome. Mirrors `games/blackout/src/runner.ts`'s shape.

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createMatch } from '@zktable/core'
import type { Match, Move, PlayerId } from '@zktable/core'
import { DICE_PER_PLAYER, MAX_PLAYERS, MIN_PLAYERS, N_PLAYERS, SIDES, liarsDice } from './liars-dice.js'
import type { LiarsDiceConfig } from './liars-dice.js'
import { DiceProver } from './dice-prover.js'
import {
  DEFAULT_LIARS_DICE_REFEREE_WASM,
  DEFAULT_VERIFIER_WASM,
  DEFAULT_VK_PATH,
  DICE_VALID_CIRCUIT_DIR,
} from './paths.js'
import { CliRefereeClient, toBe32Hex } from './referee-client.js'
import { ensureIdentities, seatIdentityNames } from './identities.js'
import type { ChainGameState } from './referee-client.js'
import { chooseMove } from './strategy.js'

export type Roster = Array<{ id: PlayerId }>

/** Fixed 2-player roster — the liars-dice-referee's v1 sound scope (see its report). */
export function buildRoster(count: number = N_PLAYERS): Roster {
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
    throw new Error(`buildRoster: count must be in [${MIN_PLAYERS}, ${MAX_PLAYERS}], got ${count}`)
  }
  const roster: Roster = []
  for (let i = 0; i < count; i++) roster.push({ id: `player${i + 1}` })
  return roster
}

/** Creates a local `Match` mirroring what the on-chain referee will enforce. */
export function createLocalMatch(roster: Roster, config: LiarsDiceConfig, seed: string): Match {
  return createMatch(liarsDice, roster, { seed, config: { liarsDice: config } })
}

export type LocalStep =
  | { playerId: PlayerId; move: { type: 'bid'; quantity: number; face: number } }
  | { playerId: PlayerId; move: { type: 'challenge' } }

/** Advances the local match by exactly one move using the seeded strategy. */
export function stepLocalMatch(match: Match, seed: string): LocalStep {
  const playerId = match.state.turn.current
  const view = match.view(playerId)
  const moveSeed = `${seed}:bid${(match.state.public.bidHistory as unknown[]).length}:${playerId}`
  const roundBefore = match.state.public.roundNumber as number
  const move = chooseMove(view, moveSeed)
  match.submit(playerId, move)
  // A challenge that continues the game re-rolls every alive player (M8.2
  // multi-round). `apply` is pure over public state, so mirror the fresh
  // rolls back into each player's secret here (same setSecret pattern as
  // Blackout's stepLocalMatch).
  if (match.state.status === 'active' && (match.state.public.roundNumber as number) !== roundBefore) {
    const rolls = match.state.public.diceByPlayer as Record<PlayerId, number[]>
    for (const [id, dice] of Object.entries(rolls)) {
      match.setSecret(id, { dice })
    }
  }
  if (move.type === 'bid') {
    return { playerId, move: { type: 'bid', quantity: move.quantity as number, face: move.face as number } }
  }
  return { playerId, move: { type: 'challenge' } }
}

/** Plays a full LOCAL game (no chain) to a natural end, guarded against runaway loops. */
export function playLocalMatch(
  roster: Roster,
  config: LiarsDiceConfig,
  seed: string,
  opts: { maxSteps?: number } = {},
): { match: Match; steps: LocalStep[] } {
  const match = createLocalMatch(roster, config, seed)
  const steps: LocalStep[] = []
  // Multi-round die-loss games run long: up to ~9 challenges (one die lost
  // each) with a full escalating bid war before every one of them.
  const maxSteps = opts.maxSteps ?? 600
  while (match.state.status === 'active' && steps.length < maxSteps) {
    steps.push(stepLocalMatch(match, seed))
  }
  if (match.state.status === 'active') {
    throw new Error(`playLocalMatch: did not reach a natural end within ${maxSteps} steps`)
  }
  return { match, steps }
}

// --- on-chain orchestration ------------------------------------------------

export type PlayLiarsDiceOptions = {
  network?: string
  source?: string
  seed?: string
  verifierWasmPath?: string
  refereeWasmPath?: string
  vkPath?: string
  log?: (line: string) => void
  /**
   * When true, provisions one funded testnet identity per seat
   * (`<source>-seat<i>`) and signs each seat's moves with its own key,
   * demonstrating genuine multi-wallet play against require_auth().
   * Default: every seat is owned and signed by `source`.
   */
  multiSeat?: boolean
}

export type Transcript = {
  verifierContractId: string
  refereeContractId: string
  roster: Roster
  seedHex: string
  nonces: Record<PlayerId, string>
  diceByPlayer: Record<PlayerId, number[]>
  moves: Array<
    | { kind: 'bid'; player: PlayerId; playerIndex: number; quantity: number; face: number }
    | { kind: 'challenge'; player: PlayerId; playerIndex: number }
  >
  reveals: Array<{ player: PlayerId; playerIndex: number; dice: number[] }>
  finalState: ChainGameState
  outcome: PlayerId | null
}

async function ensureContractWasms(log: (line: string) => void): Promise<void> {
  const { access } = await import('node:fs/promises')
  const missing: string[] = []
  for (const p of [DEFAULT_VERIFIER_WASM, DEFAULT_LIARS_DICE_REFEREE_WASM]) {
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
  const { CONTRACTS_DIR, toolEnv } = await import('./paths.js')
  await execFileAsync(
    'cargo',
    [
      '+stable',
      'build',
      '--release',
      '--target',
      'wasm32v1-none',
      '-p',
      'zktable-verifier',
      '-p',
      'zktable-liars-dice-referee',
    ],
    { cwd: CONTRACTS_DIR, env: toolEnv() },
  )
}

/** A random field-sized bigint, used for nonces/salts (never `Math.random`). */
function randomField(): bigint {
  return BigInt('0x' + randomBytes(16).toString('hex')) + 1n
}

/**
 * Plays a COMPLETE game of Liar's Dice on live Stellar testnet: deploys the
 * `dice_valid` verifier and the referee, runs the sealed nonce commit-reveal,
 * both players roll via REAL `dice_valid` proofs verified on-chain, then
 * bids/challenge/reveal per the seeded strategy to a real on-chain outcome.
 */
export async function playLiarsDice(opts: PlayLiarsDiceOptions = {}): Promise<Transcript> {
  const log = opts.log ?? ((line: string) => console.log(line))
  const seed = opts.seed ?? `liars-dice-testnet-${Date.now()}`
  const roster = buildRoster()

  await ensureContractWasms(log)
  const prover = new DiceProver({ circuitDir: DICE_VALID_CIRCUIT_DIR })
  log('ensuring dice_valid circuit is compiled + VK is built…')
  await prover.ensureVk()

  const source = opts.source ?? 'alice'
  const seatNames = seatIdentityNames(source, N_PLAYERS, opts.multiSeat ?? false)
  log(`ensuring seat identities exist + are funded: ${[...new Set(seatNames)].join(', ')}…`)
  const addressByName = await ensureIdentities(seatNames)
  const playerAddresses = seatNames.map((n) => addressByName[n]!)

  const client = new CliRefereeClient({
    network: opts.network,
    source,
    sourceForSeat: Object.fromEntries(seatNames.map((n, i) => [i, n])),
  })

  log('reading dice_valid verification key…')
  const vkHex = (await readFile(opts.vkPath ?? DEFAULT_VK_PATH)).toString('hex')

  log('deploying dice_valid verifier…')
  const verifierContractId = await client.deployVerifier(opts.verifierWasmPath ?? DEFAULT_VERIFIER_WASM, vkHex)
  log(`  verifier: ${verifierContractId}`)

  log(`deploying liars-dice referee (seats=[${seatNames.join(', ')}], dice_per_player=5, sides=6)…`)
  const refereeContractId = await client.deployReferee(opts.refereeWasmPath ?? DEFAULT_LIARS_DICE_REFEREE_WASM, {
    verifier: verifierContractId,
    playerAddresses,
    dicePerPlayer: DICE_PER_PLAYER,
    sides: SIDES,
  })
  log(`  referee: ${refereeContractId}`)

  // --- phase 1+2: sealed nonce commit-reveal -> joint seed ------------------
  const nonces = roster.map(() => randomField())
  const nonceCommitments = await Promise.all(nonces.map((n) => prover.commit(n, 0n)))

  for (let i = 0; i < roster.length; i++) {
    log(`player ${i}: committing nonce commitment (hash2(nonce, 0))…`)
    await client.commitNonce(refereeContractId, { player: i, commitmentHex: nonceCommitments[i]! })
  }
  for (let i = 0; i < roster.length; i++) {
    log(`player ${i}: revealing nonce…`)
    await client.revealNonce(refereeContractId, { player: i, nonceHex: toBe32Hex(nonces[i]!) })
  }

  const seedHex = await prover.seed(nonces)
  log(`joint seed: ${seedHex}`)
  const onChainSeed = (await client.gameState(refereeContractId)).seed
  if (onChainSeed && onChainSeed.replace(/^0x/, '') !== seedHex.replace(/^0x/, '')) {
    throw new Error(`playLiarsDice: locally-recomputed seed ${seedHex} != on-chain seed ${onChainSeed}`)
  }

  // --- phase 3: each player rolls via a REAL dice_valid proof ---------------
  const saltsByPlayer: bigint[][] = roster.map(() => Array.from({ length: DICE_PER_PLAYER }, () => randomField()))
  const diceByPlayer: Record<PlayerId, number[]> = {}
  const commitmentsByPlayer: string[][] = []

  for (let i = 0; i < roster.length; i++) {
    log(`player ${i}: proving dice_valid roll (real UltraHonk proof)…`)
    const diceProof = await prover.proveDice(seedHex, i, saltsByPlayer[i]!)
    log(`  dice: [${diceProof.dice.join(', ')}]`)
    log('  submitting submit_dice (ZK-verified on-chain)…')
    await client.submitDice(refereeContractId, {
      player: i,
      commitmentsHex: diceProof.commitmentsHex,
      proofHex: Buffer.from(diceProof.proof).toString('hex'),
    })
    diceByPlayer[roster[i]!.id] = diceProof.dice
    commitmentsByPlayer.push(diceProof.commitmentsHex)
  }

  // --- local mirror, seeded with the REAL rolled dice ------------------------
  // 'seat' loss keeps the local mirror in lockstep with the v1 referee's
  // single-round semantics (the loser is eliminated outright).
  const localMatch = createLocalMatch(roster, { diceByPlayer, lossMode: 'seat' }, seed)

  // --- phase 4: bid / challenge, driven by the seeded strategy ---------------
  const moves: Transcript['moves'] = []
  let state = await client.gameState(refereeContractId)

  while (state.phase === 'Bid') {
    const turnIdx = state.turn
    const playerId = roster[turnIdx]!.id
    const view = localMatch.view(playerId)
    const moveSeed = `${seed}:bid${state.bid_history.length}:${playerId}`
    const move: Move = chooseMove(view, moveSeed)
    localMatch.submit(playerId, move)

    if (move.type === 'bid') {
      const quantity = move.quantity as number
      const face = move.face as number
      log(`${playerId} (index ${turnIdx}) bids: ${quantity} x face ${face}`)
      await client.bid(refereeContractId, { player: turnIdx, quantity, face })
      moves.push({ kind: 'bid', player: playerId, playerIndex: turnIdx, quantity, face })
    } else {
      log(`${playerId} (index ${turnIdx}) challenges the standing bid…`)
      await client.challenge(refereeContractId, { player: turnIdx })
      moves.push({ kind: 'challenge', player: playerId, playerIndex: turnIdx })
    }
    state = await client.gameState(refereeContractId)
  }

  // --- phase 5: reveal every player's real dice + salts, resolve ------------
  const reveals: Transcript['reveals'] = []
  if (state.phase === 'Reveal') {
    for (let i = 0; i < roster.length; i++) {
      const playerId = roster[i]!.id
      const dice = diceByPlayer[playerId]!
      const saltsHex = saltsByPlayer[i]!.map(toBe32Hex)
      log(`${playerId} (index ${i}) revealing real dice [${dice.join(', ')}]…`)
      await client.revealDice(refereeContractId, { player: i, dice, saltsHex })
      reveals.push({ player: playerId, playerIndex: i, dice })
    }
    state = await client.gameState(refereeContractId)
  }

  const outcome = state.outcome !== null ? (roster[state.outcome]?.id ?? null) : null
  log(`game finished: outcome=${outcome}`)

  return {
    verifierContractId,
    refereeContractId,
    roster,
    seedHex,
    nonces: Object.fromEntries(roster.map((p, i) => [p.id, nonces[i]!.toString()])),
    diceByPlayer,
    moves,
    reveals,
    finalState: state,
    outcome,
  }
}
