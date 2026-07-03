// Stateful, per-match Liar's Dice orchestrator for the web arcade: turns
// `@zktable/liars-dice`'s batch runner primitives into step-wise operations
// an API route can call. Human = seat 0; the rest are AI (seeded strategy).
// Every roll is a REAL `dice_valid` UltraHonk proof verified on testnet; the
// human's roll is seed-derived and server-proven exactly like the AI's — the
// only hidden thing is the face VALUES until a challenge forces the reveal.
//
// Demo scope: 2-player on-chain (the v1 referee's lock), single-round
// elimination — a single challenge decides the game.

import { randomBytes, randomUUID } from "node:crypto";
import type { Move, PlayerId } from "@zktable/core";
import {
  CliRefereeClient,
  DICE_PER_PLAYER,
  DiceProver,
  N_PLAYERS,
  SIDES,
  DEFAULT_LIARS_DICE_REFEREE_WASM,
  DEFAULT_VERIFIER_WASM,
  DEFAULT_VK_PATH,
  buildRoster,
  chooseMove,
  createLocalMatch,
  ensureContractWasms,
  toBe32Hex,
  toolEnv,
} from "@zktable/liars-dice";
import type { ChainGameState } from "@zktable/liars-dice";
import { LiarsApiError } from "./errors";
import type { LiarsDto } from "./dto";
import { toLiarsDto } from "./dto";
import type { LiarsMatchRuntime } from "./store";
import { getLiarsMatch, saveLiarsMatch } from "./store";

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/contract";

/** A field-sized bigint for nonces/salts (never `Math.random`). */
function randomField(): bigint {
  return BigInt("0x" + randomBytes(16).toString("hex")) + 1n;
}

export async function createLiarsMatch(opts: { log?: (line: string) => void } = {}): Promise<LiarsDto> {
  const log = opts.log ?? (() => {});
  const network = "testnet";
  const source = "alice";
  const seed = `liars-web-${Date.now()}`;
  const roster = buildRoster(N_PLAYERS);

  await ensureContractWasms(log);
  const prover = new DiceProver();
  log("ensuring dice_valid circuit + VK…");
  await prover.ensureVk();

  const client = new CliRefereeClient({ network, source });

  const { readFile } = await import("node:fs/promises");
  const vkHex = (await readFile(DEFAULT_VK_PATH)).toString("hex");
  log("deploying dice_valid verifier…");
  const verifierId = await client.deployVerifier(DEFAULT_VERIFIER_WASM, vkHex);
  log("deploying liars-dice referee…");
  const addressByName = { alice: await addressOf(source) };
  const refereeId = await client.deployReferee(DEFAULT_LIARS_DICE_REFEREE_WASM, {
    verifier: verifierId,
    playerAddresses: roster.map(() => addressByName.alice),
    dicePerPlayer: DICE_PER_PLAYER,
    sides: SIDES,
  });
  log(`referee: ${refereeId}`);

  // Sealed nonce commit-reveal -> joint seed.
  const nonces = roster.map(() => randomField());
  const commitments = await Promise.all(nonces.map((n) => prover.commit(n, 0n)));
  for (let i = 0; i < roster.length; i++) {
    await client.commitNonce(refereeId, { player: i, commitmentHex: commitments[i]! });
  }
  for (let i = 0; i < roster.length; i++) {
    await client.revealNonce(refereeId, { player: i, nonceHex: toBe32Hex(nonces[i]!) });
  }
  const seedHex = await prover.seed(nonces);

  // Every seat rolls via a REAL dice_valid proof.
  const diceByPlayer: Record<PlayerId, number[]> = {};
  const saltsByPlayer: Record<PlayerId, bigint[]> = {};
  const log_: LiarsMatchRuntime["log"] = [];
  for (let i = 0; i < roster.length; i++) {
    const salts = Array.from({ length: DICE_PER_PLAYER }, () => randomField());
    const proof = await prover.proveDice(seedHex, i, salts);
    const rollTx = await client.submitDice(refereeId, {
      player: i,
      commitmentsHex: proof.commitmentsHex,
      proofHex: Buffer.from(proof.proof).toString("hex"),
    });
    diceByPlayer[roster[i]!.id] = proof.dice;
    saltsByPlayer[roster[i]!.id] = salts;
    log_.push({ type: "roll", player: roster[i]!.id, at: Date.now(), tx: rollTx });
    log(`player ${i} rolled + proved on-chain`);
  }

  const local = createLocalMatch(roster, { diceByPlayer, lossMode: "seat" }, seed);

  const runtime: LiarsMatchRuntime = {
    id: randomUUID(),
    refereeId,
    verifierId,
    client,
    prover,
    roster,
    humanIdx: 0,
    diceByPlayer,
    saltsByPlayer,
    local,
    seedHex,
    seed,
    explorerUrl: `${EXPLORER_BASE}/${refereeId}`,
    network,
    source,
    createdAt: Date.now(),
    log: log_,
  };
  saveLiarsMatch(runtime);
  // The human bids first (seat 0). If seat 0 were AI we'd advance here.
  return liarsDto(runtime);
}

export function requireLiarsMatch(id: string): LiarsMatchRuntime {
  const runtime = getLiarsMatch(id);
  if (!runtime) throw new LiarsApiError(404, `no liars-dice match "${id}"`);
  return runtime;
}

export async function liarsDto(runtime: LiarsMatchRuntime, opts: { reuseCachedState?: boolean } = {}): Promise<LiarsDto> {
  const state =
    opts.reuseCachedState && runtime.lastChainState
      ? runtime.lastChainState
      : await runtime.client.gameState(runtime.refereeId);
  runtime.lastChainState = state;
  return toLiarsDto(state, runtime);
}

/** Validate + submit the human's bid, mirror it, then let the AI respond. */
export async function submitHumanBid(
  runtime: LiarsMatchRuntime,
  opts: { quantity: number; face: number },
): Promise<void> {
  await gate(runtime);
  const humanId = runtime.roster[runtime.humanIdx]!.id;
  const move: Move = { type: "bid", quantity: opts.quantity, face: opts.face };
  const legal = runtime.local.legalMoves(humanId).some((m) => m.type === "bid" && m.quantity === opts.quantity && m.face === opts.face);
  if (!legal) {
    throw new LiarsApiError(400, `illegal bid ${opts.quantity}×${opts.face} (must strictly escalate the standing bid)`);
  }
  const tx = await runtime.client.bid(runtime.refereeId, { player: runtime.humanIdx, quantity: opts.quantity, face: opts.face });
  runtime.local.submit(humanId, move);
  runtime.log.push({ type: "bid", player: humanId, quantity: opts.quantity, face: opts.face, at: Date.now(), tx });
  await advanceAi(runtime);
}

/** Validate + submit the human's challenge, then resolve the reveal. */
export async function submitHumanChallenge(runtime: LiarsMatchRuntime): Promise<void> {
  const state = await gate(runtime);
  if (state.current_bid.length === 0) {
    throw new LiarsApiError(400, "nothing to challenge — no standing bid yet");
  }
  const humanId = runtime.roster[runtime.humanIdx]!.id;
  const tx = await runtime.client.challenge(runtime.refereeId, { player: runtime.humanIdx });
  runtime.local.submit(humanId, { type: "challenge" });
  runtime.log.push({ type: "challenge", player: humanId, at: Date.now(), tx });
  await resolveReveal(runtime);
}

// --- internals -------------------------------------------------------------

async function gate(runtime: LiarsMatchRuntime): Promise<ChainGameState> {
  const state = await runtime.client.gameState(runtime.refereeId);
  runtime.lastChainState = state;
  if (state.phase !== "Bid") throw new LiarsApiError(409, `not in the bidding phase (phase: ${state.phase})`);
  if (state.turn !== runtime.humanIdx) throw new LiarsApiError(409, "it is not your turn");
  return state;
}

/** Drive every consecutive AI bidding turn; a challenge triggers the reveal. */
async function advanceAi(runtime: LiarsMatchRuntime): Promise<void> {
  for (let step = 0; step < 40; step++) {
    const state = await runtime.client.gameState(runtime.refereeId);
    runtime.lastChainState = state;
    if (state.phase === "Reveal") {
      await resolveReveal(runtime);
      return;
    }
    if (state.phase !== "Bid" || state.turn === runtime.humanIdx) break;

    const aiId = runtime.roster[state.turn]!.id;
    const move = chooseMove(runtime.local.view(aiId), `${runtime.seed}:bid${state.bid_history.length}:${aiId}`);
    runtime.local.submit(aiId, move);
    if (move.type === "bid") {
      const tx = await runtime.client.bid(runtime.refereeId, {
        player: state.turn,
        quantity: move.quantity as number,
        face: move.face as number,
      });
      runtime.log.push({ type: "bid", player: aiId, quantity: move.quantity as number, face: move.face as number, at: Date.now(), tx });
    } else {
      const tx = await runtime.client.challenge(runtime.refereeId, { player: state.turn });
      runtime.log.push({ type: "challenge", player: aiId, at: Date.now(), tx });
      await resolveReveal(runtime);
      return;
    }
  }
  saveLiarsMatch(runtime);
}

/** Reveal every seat's real dice (server holds them) and let the contract resolve. */
async function resolveReveal(runtime: LiarsMatchRuntime): Promise<void> {
  const state = await runtime.client.gameState(runtime.refereeId);
  if (state.phase !== "Reveal") {
    runtime.lastChainState = state;
    saveLiarsMatch(runtime);
    return;
  }
  for (let i = 0; i < runtime.roster.length; i++) {
    const id = runtime.roster[i]!.id;
    if (state.players[i]?.revealed_dice.length) continue; // already revealed
    const tx = await runtime.client.revealDice(runtime.refereeId, {
      player: i,
      dice: runtime.diceByPlayer[id]!,
      saltsHex: runtime.saltsByPlayer[id]!.map(toBe32Hex),
    });
    runtime.log.push({ type: "reveal", player: id, dice: runtime.diceByPlayer[id]!, at: Date.now(), tx });
  }
  runtime.lastChainState = await runtime.client.gameState(runtime.refereeId);
  saveLiarsMatch(runtime);
}

async function addressOf(source: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("stellar", ["keys", "address", source], { env: toolEnv() });
  return stdout.trim();
}
