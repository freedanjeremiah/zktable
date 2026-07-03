// The Coup-lite orchestrator: local match mirroring (used by both the fast
// local tests and the on-chain runner below) and `playCoupLite`, which plays
// a COMPLETE game on live Stellar testnet - real semi-honestly dealt hand
// commitments, real `card_membership` "prove-hold-or-bluff" proofs verified
// on-chain, real claim/challenge/reveal, a real on-chain outcome. Mirrors
// `games/liars-dice/src/runner.ts`'s shape.

import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createMatch } from '@zktable/core'
import type { Match, PlayerId } from '@zktable/core'
import { CHARACTER_NAMES, N_PLAYERS, coupLite } from './coup-lite.js'
import type { CoupLiteConfig, Hand, ClaimEntry } from './coup-lite.js'
import { CardProver } from './card-prover.js'
import {
  DEFAULT_COUP_REFEREE_WASM,
  DEFAULT_VERIFIER_WASM,
  DEFAULT_VK_PATH,
  CARD_MEMBERSHIP_CIRCUIT_DIR,
} from './paths.js'
import { CliRefereeClient, toBe32Hex } from './referee-client.js'
import { ensureIdentities, seatIdentityNames } from './identities.js'
import type { ChainGameState } from './referee-client.js'
import { chooseMove } from './strategy.js'

export type Roster = Array<{ id: PlayerId }>

/** Fixed 2-player roster - this showcase's `defineGame`/on-chain demo scope (see `coup-lite.ts`'s module doc). */
export function buildRoster(): Roster {
  const roster: Roster = []
  for (let i = 0; i < N_PLAYERS; i++) roster.push({ id: `player${i + 1}` })
  return roster
}

/** Creates a local `Match` mirroring what the on-chain referee will enforce. */
export function createLocalMatch(roster: Roster, config: CoupLiteConfig, seed: string): Match {
  return createMatch(coupLite, roster, { seed, config: { coupLite: config } })
}

export type LocalStep =
  | { playerId: PlayerId; move: { type: 'claim'; character: number } }
  | { playerId: PlayerId; move: { type: 'challenge' } }

/** Advances the local match by exactly one move using the seeded strategy. */
export function stepLocalMatch(match: Match, seed: string): LocalStep {
  const playerId = match.state.turn.current
  const view = match.view(playerId)
  const moveSeed = `${seed}:move${(match.state.public.claimHistory as unknown[]).length}:${playerId}`
  const move = chooseMove(view, moveSeed)
  match.submit(playerId, move)
  if (move.type === 'claim') {
    return { playerId, move: { type: 'claim', character: move.character as number } }
  }
  return { playerId, move: { type: 'challenge' } }
}

/** Plays a full LOCAL game (no chain) to a natural end, guarded against runaway loops. */
export function playLocalMatch(
  roster: Roster,
  config: CoupLiteConfig,
  seed: string,
  opts: { maxSteps?: number } = {},
): { match: Match; steps: LocalStep[] } {
  const match = createLocalMatch(roster, config, seed)
  const steps: LocalStep[] = []
  const maxSteps = opts.maxSteps ?? 200
  while (match.state.status === 'active' && steps.length < maxSteps) {
    steps.push(stepLocalMatch(match, seed))
  }
  if (match.state.status === 'active') {
    throw new Error(`playLocalMatch: did not reach a natural end within ${maxSteps} steps`)
  }
  return { match, steps }
}

// --- on-chain orchestration ------------------------------------------------

export type PlayCoupLiteOptions = {
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
  handsByPlayer: Record<PlayerId, Hand>
  moves: Array<
    | { kind: 'claim'; player: PlayerId; playerIndex: number; character: number }
    | {
        kind: 'challenge'
        challenger: PlayerId
        challengerIndex: number
        target: PlayerId
        targetIndex: number
        claim: ClaimEntry
        claimWasTrue: boolean
        loser: PlayerId
      }
  >
  finalState: ChainGameState
  outcome: PlayerId | null
}

async function ensureContractWasms(log: (line: string) => void): Promise<void> {
  const { access } = await import('node:fs/promises')
  const missing: string[] = []
  for (const p of [DEFAULT_VERIFIER_WASM, DEFAULT_COUP_REFEREE_WASM]) {
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
      'zktable-coup-referee',
    ],
    { cwd: CONTRACTS_DIR, env: toolEnv() },
  )
}

/** A random field-sized bigint, used for salts (never `Math.random`). */
function randomField(): bigint {
  return BigInt('0x' + randomBytes(16).toString('hex')) + 1n
}

/** Picks the first not-yet-revealed hand slot (0 then 1) - matches `coup-lite.ts`'s `loseInfluence` slot policy exactly. */
function nextDeadSlot(dead: [boolean, boolean]): 0 | 1 {
  return dead[0] ? 1 : 0
}

/**
 * Plays a COMPLETE game of Coup-lite on live Stellar testnet: deploys the
 * `card_membership` verifier and the coup-referee, deals both players'
 * semi-honestly committed hands, then claims/challenges per the seeded
 * strategy - resolving each challenge with a REAL `card_membership` proof
 * (when the claim was true) or a direct `reveal_card` decline (when it was a
 * bluff) - to a real on-chain outcome.
 */
export async function playCoupLite(opts: PlayCoupLiteOptions = {}): Promise<Transcript> {
  const log = opts.log ?? ((line: string) => console.log(line))
  const seed = opts.seed ?? `coup-lite-testnet-${Date.now()}`
  const roster = buildRoster()

  await ensureContractWasms(log)
  const prover = new CardProver({ circuitDir: CARD_MEMBERSHIP_CIRCUIT_DIR })
  log('ensuring card_membership circuit is compiled + VK is built…')
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

  log('reading card_membership verification key…')
  const vkHex = (await readFile(opts.vkPath ?? DEFAULT_VK_PATH)).toString('hex')

  log('deploying card_membership verifier…')
  const verifierContractId = await client.deployVerifier(opts.verifierWasmPath ?? DEFAULT_VERIFIER_WASM, vkHex)
  log(`  verifier: ${verifierContractId}`)

  log(`deploying coup-referee (seats=[${seatNames.join(', ')}])…`)
  const refereeContractId = await client.deployReferee(opts.refereeWasmPath ?? DEFAULT_COUP_REFEREE_WASM, {
    verifier: verifierContractId,
    playerAddresses,
  })
  log(`  referee: ${refereeContractId}`)

  // --- deal phase: a semi-honest orchestrator (this runner) deals each
  //     player a real, distinct 2-character hand + commitments -----------
  const handsByPlayer: Record<PlayerId, Hand> = {}
  const saltsByPlayer: Record<PlayerId, [bigint, bigint]> = {}
  const deadByPlayer: Record<PlayerId, [boolean, boolean]> = {}
  for (let i = 0; i < roster.length; i++) {
    const playerId = roster[i]!.id
    // Distinct characters from the 5-character pool, deterministic per seed.
    const pool = [0, 1, 2, 3, 4]
    const i0 = Math.floor((hashOf(`${seed}:${playerId}:c0`) % pool.length))
    const c0 = pool.splice(i0, 1)[0]!
    const i1 = Math.floor(hashOf(`${seed}:${playerId}:c1`) % pool.length)
    const c1 = pool.splice(i1, 1)[0]!
    const hand: Hand = [c0, c1]
    const salts: [bigint, bigint] = [randomField(), randomField()]
    handsByPlayer[playerId] = hand
    saltsByPlayer[playerId] = salts
    deadByPlayer[playerId] = [false, false]

    log(`player ${i}: dealing hand [${hand.join(', ')}] (${hand.map((c) => CHARACTER_NAMES[c]).join(', ')})…`)
    const dealt = await prover.deal([BigInt(hand[0]), BigInt(hand[1])], salts)
    await client.deal(refereeContractId, { player: i, commitmentsHex: dealt.commitmentsHex })
  }

  // --- local mirror, seeded with the REAL dealt hands ------------------------
  const localMatch = createLocalMatch(roster, { handsByPlayer }, seed)

  const moves: Transcript['moves'] = []
  let state = await client.gameState(refereeContractId)
  let guard = 0
  const maxSteps = 40

  while (state.phase === 'Playing' && guard < maxSteps) {
    guard += 1
    const turnIdx = state.turn
    const playerId = roster[turnIdx]!.id
    const view = localMatch.view(playerId)
    const moveSeed = `${seed}:move${moves.length}:${playerId}`
    const move = chooseMove(view, moveSeed)

    if (move.type === 'claim') {
      const character = move.character as number
      log(`${playerId} (index ${turnIdx}) claims: ${CHARACTER_NAMES[character]} (${character})`)
      await client.claim(refereeContractId, { player: turnIdx, character })
      localMatch.submit(playerId, move)
      moves.push({ kind: 'claim', player: playerId, playerIndex: turnIdx, character })
    } else {
      const claim = localMatch.state.public.lastClaim as ClaimEntry
      const targetIdx = roster.findIndex((p) => p.id === claim.player)
      const targetHand = handsByPlayer[claim.player]!
      const claimWasTrue = targetHand.includes(claim.character)
      log(
        `${playerId} (index ${turnIdx}) challenges ${claim.player} (index ${targetIdx})'s claim of ${CHARACTER_NAMES[claim.character]}…`,
      )
      await client.challenge(refereeContractId, { challenger: turnIdx, target: targetIdx })

      let loser: PlayerId
      if (claimWasTrue) {
        const heldIndex = targetHand.indexOf(claim.character) as 0 | 1
        log(`  claim is TRUE - ${claim.player} proves it in ZK (real card_membership proof)…`)
        const proof = await prover.proveHold(
          BigInt(claim.character),
          [BigInt(targetHand[0]), BigInt(targetHand[1])],
          saltsByPlayer[claim.player]!,
          heldIndex,
        )
        await client.proveHold(refereeContractId, {
          target: targetIdx,
          claimed: claim.character,
          proofHex: Buffer.from(proof.proof).toString('hex'),
        })
        loser = playerId // the CHALLENGER loses
        const loserDead = deadByPlayer[loser]!
        const slot = nextDeadSlot(loserDead)
        const loserHand = handsByPlayer[loser]!
        log(`  challenger ${loser} loses influence - revealing real card ${loserHand[slot]}…`)
        await client.revealCard(refereeContractId, {
          player: turnIdx,
          slot,
          card: loserHand[slot],
          saltHex: toBe32Hex(saltsByPlayer[loser]![slot]),
        })
        loserDead[slot] = true
      } else {
        loser = claim.player // the TARGET declines and loses
        const loserDead = deadByPlayer[loser]!
        const slot = nextDeadSlot(loserDead)
        log(`  claim is a BLUFF - ${loser} declines and reveals real card ${targetHand[slot]}…`)
        await client.revealCard(refereeContractId, {
          player: targetIdx,
          slot,
          card: targetHand[slot],
          saltHex: toBe32Hex(saltsByPlayer[loser]![slot]),
        })
        loserDead[slot] = true
      }

      localMatch.submit(playerId, { type: 'challenge' })
      moves.push({
        kind: 'challenge',
        challenger: playerId,
        challengerIndex: turnIdx,
        target: claim.player,
        targetIndex: targetIdx,
        claim,
        claimWasTrue,
        loser,
      })
    }
    state = await client.gameState(refereeContractId)
  }

  const outcome = state.outcome !== null ? (roster[state.outcome]?.id ?? null) : null
  log(`game finished: outcome=${outcome}`)

  return {
    verifierContractId,
    refereeContractId,
    roster,
    handsByPlayer,
    moves,
    finalState: state,
    outcome,
  }
}

/** Small deterministic (non-cryptographic) hash used only to pick dealt hands - NOT the seed used for on-chain fairness (there is none here: v1 dealing is semi-honest, see the module doc). */
function hashOf(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
