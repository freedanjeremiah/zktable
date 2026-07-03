// Stateful, per-match Coup-lite orchestrator for the web arcade. Human =
// seat 0, AI = seat 1. The deal is PROVABLY FAIR (M8.3): seed commit-reveal
// + a real `valid_shuffle` proof + position-assigned hands. Every "prove
// hold" on a truthful claim is a real `card_membership` UltraHonk proof
// verified on testnet. The server holds all hands (it dealt them) and
// resolves challenges — the human sees only their own hand.

import { randomBytes, randomUUID } from "node:crypto";
import type { PlayerId } from "@zktable/core";
import {
  CardProver,
  CHARACTER_NAMES,
  CliRefereeClient,
  DEFAULT_COUP_REFEREE_WASM,
  DEFAULT_SHUFFLE_VK_PATH,
  DEFAULT_VERIFIER_WASM,
  DEFAULT_VK_PATH,
  N_PLAYERS,
  buildRoster,
  chooseMove,
  createLocalMatch,
  ensureContractWasms,
  toBe32Hex,
  toolEnv,
} from "@zktable/coup-lite";
import type { ChainGameState, Hand } from "@zktable/coup-lite";
import { CoupApiError } from "./errors";
import type { CoupDto } from "./dto";
import { toCoupDto } from "./dto";
import type { CoupMatchRuntime } from "./store";
import { getCoupMatch, saveCoupMatch } from "./store";

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/contract";

function randomField(): bigint {
  return BigInt("0x" + randomBytes(16).toString("hex")) + 1n;
}
function nextDeadSlot(dead: [boolean, boolean]): 0 | 1 {
  return dead[0] ? 1 : 0;
}

export async function createCoupMatch(opts: { log?: (line: string) => void } = {}): Promise<CoupDto> {
  const log = opts.log ?? (() => {});
  const network = "testnet";
  const source = "alice";
  const seed = `coup-web-${Date.now()}`;
  const roster = buildRoster(N_PLAYERS);

  await ensureContractWasms(log);
  const prover = new CardProver();
  log("ensuring card_membership + valid_shuffle circuits + VKs…");
  await prover.ensureVk();
  await prover.ensureShuffleVk();

  const client = new CliRefereeClient({ network, source });
  const { readFile } = await import("node:fs/promises");
  const vkHex = (await readFile(DEFAULT_VK_PATH)).toString("hex");
  const shuffleVkHex = (await readFile(DEFAULT_SHUFFLE_VK_PATH)).toString("hex");

  log("deploying card_membership + valid_shuffle verifiers…");
  const verifierId = await client.deployVerifier(DEFAULT_VERIFIER_WASM, vkHex);
  const shuffleVerifierId = await client.deployVerifier(DEFAULT_VERIFIER_WASM, shuffleVkHex);
  const addr = await addressOf(source);
  log("deploying coup referee…");
  const refereeId = await client.deployReferee(DEFAULT_COUP_REFEREE_WASM, {
    verifier: verifierId,
    shuffleVerifier: shuffleVerifierId,
    playerAddresses: roster.map(() => addr),
  });
  log(`referee: ${refereeId}`);

  // Seed commit-reveal -> joint seed.
  const nonces = roster.map(() => randomField());
  for (let i = 0; i < roster.length; i++) {
    await client.commitSeedNonce(refereeId, { player: i, commitmentHex: await prover.commit(nonces[i]!, 0n) });
  }
  for (let i = 0; i < roster.length; i++) {
    await client.revealSeedNonce(refereeId, { player: i, nonceHex: toBe32Hex(nonces[i]!) });
  }
  const seedHex = await prover.seed(nonces);

  // Provably-fair shuffle; hands by fixed deck position.
  const deckSalts = Array.from({ length: 15 }, () => randomField());
  log("proving valid_shuffle (the seed forces the deck order)…");
  const shuffle = await prover.proveShuffle(seedHex, deckSalts);
  if (!(await prover.shuffleLocalVerify(shuffle.proof, shuffle.publicInputs))) {
    throw new CoupApiError(500, "valid_shuffle proof failed local verification");
  }
  await client.submitShuffle(refereeId, {
    leavesHex: shuffle.leavesHex,
    proofHex: Buffer.from(shuffle.proof).toString("hex"),
  });

  const handsByPlayer: Record<PlayerId, Hand> = {};
  const saltsByPlayer: Record<PlayerId, [bigint, bigint]> = {};
  const deadByPlayer: Record<PlayerId, [boolean, boolean]> = {};
  for (let i = 0; i < roster.length; i++) {
    const id = roster[i]!.id;
    handsByPlayer[id] = [shuffle.cards[2 * i]!, shuffle.cards[2 * i + 1]!];
    saltsByPlayer[id] = [BigInt(shuffle.salts[2 * i]!), BigInt(shuffle.salts[2 * i + 1]!)];
    deadByPlayer[id] = [false, false];
  }

  const local = createLocalMatch(roster, { handsByPlayer }, seed);

  const runtime: CoupMatchRuntime = {
    id: randomUUID(),
    refereeId,
    verifierId,
    shuffleVerifierId,
    client,
    prover,
    roster,
    humanIdx: 0,
    handsByPlayer,
    saltsByPlayer,
    deadByPlayer,
    local,
    seed,
    explorerUrl: `${EXPLORER_BASE}/${refereeId}`,
    network,
    source,
    createdAt: Date.now(),
    log: [{ type: "deal", at: Date.now() }],
  };
  saveCoupMatch(runtime);
  return coupDto(runtime);
}

export function requireCoupMatch(id: string): CoupMatchRuntime {
  const r = getCoupMatch(id);
  if (!r) throw new CoupApiError(404, `no coup-lite match "${id}"`);
  return r;
}

export async function coupDto(runtime: CoupMatchRuntime, opts: { reuseCachedState?: boolean } = {}): Promise<CoupDto> {
  const state =
    opts.reuseCachedState && runtime.lastChainState
      ? runtime.lastChainState
      : await runtime.client.gameState(runtime.refereeId);
  runtime.lastChainState = state;
  return toCoupDto(state, runtime);
}

/** Human claims a character on their turn. */
export async function submitHumanClaim(runtime: CoupMatchRuntime, character: number): Promise<void> {
  await gate(runtime);
  if (character < 0 || character >= CHARACTER_NAMES.length) {
    throw new CoupApiError(400, `character must be 0..${CHARACTER_NAMES.length - 1}`);
  }
  const humanId = runtime.roster[runtime.humanIdx]!.id;
  await runtime.client.claim(runtime.refereeId, { player: runtime.humanIdx, character });
  runtime.local.submit(humanId, { type: "claim", character });
  runtime.log.push({ type: "claim", player: humanId, character, at: Date.now() });
  await advanceAi(runtime);
}

/** Human challenges the standing claim (by the AI). */
export async function submitHumanChallenge(runtime: CoupMatchRuntime): Promise<void> {
  const state = await gate(runtime);
  if (state.last_claim_player === null || state.last_claim_player === runtime.humanIdx) {
    throw new CoupApiError(400, "no standing claim by the opponent to challenge");
  }
  const humanId = runtime.roster[runtime.humanIdx]!.id;
  runtime.local.submit(humanId, { type: "challenge" });
  await resolveChallenge(runtime, runtime.humanIdx, state.last_claim_player, state.last_claim_character!);
  await advanceAi(runtime);
}

// --- internals -------------------------------------------------------------

async function gate(runtime: CoupMatchRuntime): Promise<ChainGameState> {
  const state = await runtime.client.gameState(runtime.refereeId);
  runtime.lastChainState = state;
  if (state.phase !== "Playing") throw new CoupApiError(409, `not in the playing phase (phase: ${state.phase})`);
  if (state.turn !== runtime.humanIdx) throw new CoupApiError(409, "it is not your turn");
  return state;
}

/** Resolve a challenge on-chain (server holds all hands): prove-hold on a
 *  truthful claim, or a decline+reveal on a bluff. Ports the runner block. */
async function resolveChallenge(
  runtime: CoupMatchRuntime,
  challengerIdx: number,
  targetIdx: number,
  claimedChar: number,
): Promise<void> {
  const challengerId = runtime.roster[challengerIdx]!.id;
  const targetId = runtime.roster[targetIdx]!.id;
  const targetHand = runtime.handsByPlayer[targetId]!;
  const claimWasTrue = targetHand.includes(claimedChar);

  await runtime.client.challenge(runtime.refereeId, { challenger: challengerIdx, target: targetIdx });

  let loser: PlayerId;
  if (claimWasTrue) {
    const heldIndex = targetHand.indexOf(claimedChar) as 0 | 1;
    const proof = await runtime.prover.proveHold(
      BigInt(claimedChar),
      [BigInt(targetHand[0]), BigInt(targetHand[1])],
      runtime.saltsByPlayer[targetId]!,
      heldIndex,
    );
    await runtime.client.proveHold(runtime.refereeId, {
      target: targetIdx,
      claimed: claimedChar,
      proofHex: Buffer.from(proof.proof).toString("hex"),
    });
    // The claim was truthful → the CHALLENGER loses an influence.
    loser = challengerId;
    const dead = runtime.deadByPlayer[loser]!;
    const slot = nextDeadSlot(dead);
    await runtime.client.revealCard(runtime.refereeId, {
      player: challengerIdx,
      slot,
      card: runtime.handsByPlayer[loser]![slot],
      saltHex: toBe32Hex(runtime.saltsByPlayer[loser]![slot]),
    });
    dead[slot] = true;
  } else {
    // Bluff → the TARGET declines and loses an influence.
    loser = targetId;
    const dead = runtime.deadByPlayer[loser]!;
    const slot = nextDeadSlot(dead);
    await runtime.client.revealCard(runtime.refereeId, {
      player: targetIdx,
      slot,
      card: targetHand[slot],
      saltHex: toBe32Hex(runtime.saltsByPlayer[loser]![slot]),
    });
    dead[slot] = true;
  }
  runtime.log.push({ type: "challenge", challenger: challengerId, target: targetId, claimWasTrue, loser, at: Date.now() });
  runtime.lastChainState = await runtime.client.gameState(runtime.refereeId);
}

/** Drive consecutive AI turns; the AI may claim or challenge the human's claim. */
async function advanceAi(runtime: CoupMatchRuntime): Promise<void> {
  for (let step = 0; step < 40; step++) {
    const state = await runtime.client.gameState(runtime.refereeId);
    runtime.lastChainState = state;
    if (state.phase !== "Playing" || state.turn === runtime.humanIdx) break;

    const aiIdx = state.turn;
    const aiId = runtime.roster[aiIdx]!.id;
    const move = chooseMove(runtime.local.view(aiId), `${runtime.seed}:move${runtime.log.length}:${aiId}`);
    if (move.type === "claim") {
      const character = move.character as number;
      await runtime.client.claim(runtime.refereeId, { player: aiIdx, character });
      runtime.local.submit(aiId, move);
      runtime.log.push({ type: "claim", player: aiId, character, at: Date.now() });
    } else {
      // AI challenges the standing claim (by the human).
      const targetIdx = state.last_claim_player!;
      runtime.local.submit(aiId, { type: "challenge" });
      await resolveChallenge(runtime, aiIdx, targetIdx, state.last_claim_character!);
    }
  }
  saveCoupMatch(runtime);
}

async function addressOf(source: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("stellar", ["keys", "address", source], { env: toolEnv() });
  return stdout.trim();
}
