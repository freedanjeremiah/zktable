// The stateful, per-match Blackout orchestrator: turns `games/blackout`'s
// batch `playBlackout` runner into step-wise operations an API route can
// call. Reuses every proving/contract primitive as-is —
// `CliRefereeClient`, `BoardGraph`/`BoardProver`, `createLocalMatch` — this
// file only adds the "one HTTP call = one step" wiring + the in-memory
// match store.

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { BoardGraph, BoardProver } from "@zktable/circuits";
import type { Agent } from "@zktable/agents";
import { ClaudeAgent, HeuristicAgent } from "@zktable/agents";
import type { PlayerId, PlayerView } from "@zktable/core";
import {
  CITY,
  CliRefereeClient,
  DEFAULT_N_ROUNDS,
  DEFAULT_REFEREE_WASM,
  DEFAULT_REVEAL_ROUNDS,
  DEFAULT_TICKETS,
  DEFAULT_VERIFIER_WASM,
  DEFAULT_VK_PATH,
  addressOf,
  blackoutInvestigatorPolicy,
  blackoutPhantomPolicy,
  buildRoster,
  cityGraphData,
  createLocalMatch,
  ensureContractWasms,
  ensureVk,
  randomSalt,
  rosterTickets,
  toBe32Hex,
} from "@zktable/blackout";
import type { BlackoutConfig, ChainGameState } from "@zktable/blackout";
import { BlackoutApiError } from "./errors";
import type { MatchDto } from "./dto";
import { toDto } from "./dto";
import type { MatchRuntime } from "./match-store";
import { getMatch, saveMatch } from "./match-store";
import { pickStartPositions } from "./start-positions";
import { buildUnsignedInvokeXdr, sendSignedTx } from "./prepare";
import { legalPublicMovesFromChain } from "./legal-moves";

export type CreateMatchOptions = {
  /** Total investigator seats. Defaults to 3 (one human + two AI). */
  investigators?: number;
  /** How many of those seats are AI-controlled (the rest are human). Defaults to `investigators - 1`. */
  aiInvestigators?: number;
  /** Claude model override for AI seats, when `ANTHROPIC_API_KEY` is set. */
  model?: string;
  network?: string;
  source?: string;
  /**
   * Freighter wallet G-address for the (first) human investigator seat.
   * When set, that seat is joined with THIS address — the referee's
   * require_auth() then demands the wallet's signature on every one of its
   * moves, so its `set_public_start` and moves go prepare/sign/submit and
   * `start()` is deferred until the signed start lands.
   */
  walletAddress?: string;
  /** 'human' seats the PHANTOM as a browser-proving human (M8.5): the
   * server never learns the hidden position — the browser generates the
   * start commitment and every move proof locally. Default 'ai'. */
  phantomSeat?: "ai" | "human";
  /** List the match in the open lobby with its human seat unclaimed. */
  open?: boolean;
  /** The creating browser's session token — claims the human seat unless `open`. */
  sessionToken?: string;
  log?: (line: string) => void;
};

const EXPLORER_BASE = "https://stellar.expert/explorer/testnet/contract";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function buildAgent(model: string | undefined, role: "phantom" | "investigator"): Agent {
  const policy = role === "phantom" ? blackoutPhantomPolicy : blackoutInvestigatorPolicy;
  if (process.env.ANTHROPIC_API_KEY) {
    return new ClaudeAgent({
      model,
      system:
        role === "phantom"
          ? "You are the Phantom in Blackout, a Scotland-Yard-style hidden pursuit game. Evade the Investigators; you only see your own hidden position."
          : "You are an Investigator in Blackout, a Scotland-Yard-style hidden pursuit game. Hunt the Phantom using ticket types played and periodic position reveals.",
    });
  }
  return new HeuristicAgent(policy);
}

/**
 * Deploys a fresh verifier + referee, joins 1 Phantom + N Investigators
 * (some human, the rest AI), sets starting positions, and `start()`s the
 * match. Real testnet deploys — ~15-30s. Does NOT auto-advance the Phantom's
 * opening turn; callers hit `/ai-turn` next (see `advanceAiTurns`).
 */
export async function createBlackoutMatch(opts: CreateMatchOptions = {}): Promise<MatchDto> {
  const log = opts.log ?? (() => {});
  const network = opts.network ?? "testnet";
  const source = opts.source ?? "alice";

  const investigatorCount = clamp(Math.trunc(opts.investigators ?? 3), 1, 5);
  const defaultAiInvestigators = Math.max(investigatorCount - 1, 0);
  const aiInvestigatorCount = clamp(
    Math.trunc(opts.aiInvestigators ?? defaultAiInvestigators),
    0,
    investigatorCount,
  );

  const phantomHuman = opts.phantomSeat === "human";
  if (phantomHuman && opts.walletAddress) {
    throw new BlackoutApiError(400, "phantomSeat: 'human' cannot be combined with walletAddress (yet)");
  }

  const roster = buildRoster(investigatorCount);

  await ensureContractWasms(log);
  await ensureVk(log, DEFAULT_VK_PATH);

  const graph = new BoardGraph(cityGraphData);
  const client = new CliRefereeClient({ network, source });

  log("computing graph root…");
  const graphRootHex = await graph.root();

  log("reading move_along verification key…");
  const vkHex = (await readFile(DEFAULT_VK_PATH)).toString("hex");

  log("deploying move_along verifier…");
  const verifierContractId = await client.deployVerifier(DEFAULT_VERIFIER_WASM, vkHex);
  log(`  verifier: ${verifierContractId}`);

  log("deploying referee…");
  const refereeContractId = await client.deployReferee(DEFAULT_REFEREE_WASM, {
    verifier: verifierContractId,
    graphRootHex,
    nRounds: DEFAULT_N_ROUNDS,
    revealRounds: DEFAULT_REVEAL_ROUNDS,
  });
  log(`  referee: ${refereeContractId}`);

  const addr = await addressOf(source);

  // The human seat is the FIRST investigator entry (AI seats are the last
  // `aiInvestigatorCount` — see the agents map below). When a wallet address
  // is provided it owns that seat on-chain.
  const investigatorIds = roster.filter((p) => p.role === "investigator").map((p) => p.id);
  const humanSeatId = aiInvestigatorCount < investigatorCount ? investigatorIds[0] : undefined;

  const playerIndex = new Map<PlayerId, number>();
  const indexToPlayer = new Map<number, PlayerId>();
  for (const p of roster) {
    const seatAddr = opts.walletAddress && p.id === humanSeatId ? opts.walletAddress : addr;
    log(`joining ${p.id} (${p.role})…`);
    const idx = await client.join(refereeContractId, {
      addr: seatAddr,
      role: p.role,
      ticketTaxi: DEFAULT_TICKETS.taxi,
      ticketBus: DEFAULT_TICKETS.bus,
      ticketRail: DEFAULT_TICKETS.rail,
    });
    playerIndex.set(p.id, idx);
    indexToPlayer.set(idx, p.id);
  }

  const { phantom: phantomStart, investigators: investigatorStarts } = pickStartPositions(
    CITY.nodes,
    investigatorCount,
  );
  const investigatorEntries = roster.filter((p) => p.role === "investigator");
  const startPositions: Record<PlayerId, number> = { phantom: phantomStart };
  investigatorEntries.forEach((p, i) => {
    startPositions[p.id] = investigatorStarts[i]!;
  });

  // Human Phantom (M8.5): the BROWSER generates position + salt and posts
  // only the commitment (phantom-start route); the server holds no secret.
  let phantomSecret: MatchRuntime["phantom"] = null;
  if (!phantomHuman) {
    const phantomSalt = randomSalt();
    phantomSecret = { pos: phantomStart, salt: phantomSalt };
    const initialCommitment = await graph.commit(phantomStart, phantomSalt);
    log(`setting Phantom hidden start (node ${phantomStart})…`);
    await client.setHiddenStart(refereeContractId, playerIndex.get("phantom")!, initialCommitment);
  }

  // The wallet-bound seat's set_public_start must be signed by the wallet
  // (require_auth), so the server can only PREPARE it; start() is deferred
  // until the signed envelope lands (completeSignedStart).
  const walletSeatEntry =
    opts.walletAddress && humanSeatId ? { player: playerIndex.get(humanSeatId)!, address: opts.walletAddress } : undefined;
  let pendingStart: MatchRuntime["pendingStart"];

  for (const p of investigatorEntries) {
    const node = startPositions[p.id]!;
    if (walletSeatEntry && p.id === humanSeatId) {
      log(`preparing ${p.id} public start (node ${node}) for wallet signature…`);
      const xdr = await buildUnsignedInvokeXdr({
        contractId: refereeContractId,
        network,
        sourceAccount: walletSeatEntry.address,
        method: "set_public_start",
        methodArgs: ["--player", String(walletSeatEntry.player), "--node", String(node)],
      });
      pendingStart = { player: walletSeatEntry.player, node, xdr };
      continue;
    }
    log(`setting ${p.id} public start (node ${node})…`);
    await client.setPublicStart(refereeContractId, playerIndex.get(p.id)!, node);
  }

  if (!pendingStart && !phantomHuman) {
    log("starting the match…");
    await client.start(refereeContractId);
  }

  const config: BlackoutConfig = {
    startPositions,
    tickets: rosterTickets(roster, DEFAULT_TICKETS),
    nRounds: DEFAULT_N_ROUNDS,
    revealRounds: DEFAULT_REVEAL_ROUNDS,
  };
  const localSeed = `blackout-web-${Date.now()}`;
  const local = createLocalMatch(roster, config, localSeed);

  // AI seats: the Phantom always, plus the LAST `aiInvestigatorCount`
  // investigator seats — so with the default (investigators=3,
  // aiInvestigators=2) `investigator1` is the human seat.
  const agents = new Map<PlayerId, Agent>();
  if (!phantomHuman) agents.set("phantom", buildAgent(opts.model, "phantom"));
  const aiInvestigatorEntries = investigatorEntries.slice(investigatorEntries.length - aiInvestigatorCount);
  for (const p of aiInvestigatorEntries) {
    agents.set(p.id, buildAgent(opts.model, "investigator"));
  }

  // Human seats get a session binding (M8.4): claimed by the creator's
  // token unless the match is opened to the lobby.
  const seats: MatchRuntime["seats"] = {};
  for (const p of roster) {
    if (agents.has(p.id)) continue;
    seats[p.id] = opts.open
      ? { open: true }
      : { open: false, token: opts.sessionToken };
  }

  const runtime: MatchRuntime = {
    id: randomUUID(),
    refereeId: refereeContractId,
    verifierId: verifierContractId,
    client,
    graph,
    local,
    roster,
    playerIndex,
    indexToPlayer,
    phantom: phantomSecret,
    agents,
    model: opts.model,
    config,
    explorerUrl: `${EXPLORER_BASE}/${refereeContractId}`,
    network,
    source,
    createdAt: Date.now(),
    localSeed,
    log: [],
    walletSeat: walletSeatEntry,
    pendingStart,
    seats,
    open: opts.open ?? false,
    phantomHuman,
    pendingPhantomStart: phantomHuman,
  };
  await saveMatch(runtime);

  return fetchDto(runtime);
}

/** Claims an open human seat for the caller's session token. */
export async function joinOpenMatch(runtime: MatchRuntime, sessionToken: string): Promise<PlayerId> {
  const openSeat = Object.entries(runtime.seats).find(([, seat]) => seat.open && !seat.token);
  if (!openSeat) throw new BlackoutApiError(409, "no open seat to join in this match");
  const [playerId] = openSeat;
  runtime.seats[playerId] = { open: false, token: sessionToken };
  runtime.open = Object.values(runtime.seats).some((seat) => seat.open && !seat.token);
  await saveMatch(runtime);
  return playerId;
}

/**
 * Lands the wallet-signed `set_public_start`, then `start()`s the match
 * (server-signed — start is permissionless once the roster is complete).
 */
export async function completeSignedStart(runtime: MatchRuntime, signedXdr: string): Promise<void> {
  if (!runtime.pendingStart) {
    throw new BlackoutApiError(409, "this match has no pending start awaiting a signature");
  }
  await sendSignedTx(runtime.network, signedXdr);
  await runtime.client.start(runtime.refereeId);
  runtime.pendingStart = undefined;
  await saveMatch(runtime);
}

export async function requireMatch(matchId: string): Promise<MatchRuntime> {
  const runtime = await getMatch(matchId, buildAgent);
  if (!runtime) throw new BlackoutApiError(404, `no match with id "${matchId}"`);
  return runtime;
}

export async function fetchDto(
  runtime: MatchRuntime,
  opts: { reuseCachedState?: boolean } = {},
): Promise<MatchDto> {
  // Mutation routes end with advanceAiTurns, whose exit condition already
  // read the current chain state — reuse it instead of a duplicate
  // subprocess+RPC round trip. GET paths pass nothing and stay fresh.
  const state =
    opts.reuseCachedState && runtime.lastChainState
      ? runtime.lastChainState
      : await runtime.client.gameState(runtime.refereeId);
  runtime.lastChainState = state;
  if (!runtime.phantomHuman) return toDto(state, runtime);
  // Human-Phantom matches have no engine mirror: investigator legality comes
  // from the public graph + chain state; the Phantom computes its own
  // legality in the browser (legalMoves stays undefined for that seat).
  return toDto(state, {
    ...runtime,
    legalMovesFor: (playerId) => {
      const idx = runtime.playerIndex.get(playerId);
      const entry = runtime.roster.find((p) => p.id === playerId);
      if (idx === undefined || entry?.role !== "investigator") return undefined;
      return legalPublicMovesFromChain(state, idx);
    },
  });
}

/** The Phantom roster id + seat index for a human-Phantom match. */
function phantomSeatIndex(runtime: MatchRuntime): number {
  const idx = runtime.playerIndex.get("phantom");
  if (idx === undefined) throw new BlackoutApiError(500, "match has no phantom seat");
  return idx;
}

function assertPhantomSession(runtime: MatchRuntime, sessionToken: string | undefined): void {
  if (!runtime.phantomHuman) {
    throw new BlackoutApiError(400, "this match's Phantom is AI-controlled");
  }
  const seat = runtime.seats["phantom"];
  if (seat?.token && seat.token !== sessionToken) {
    throw new BlackoutApiError(403, 'seat "phantom" belongs to a different session');
  }
}

/**
 * Lands the browser-generated hidden-start commitment and starts the match
 * (M8.5). The commitment is the ONLY thing the server ever sees — position
 * and salt stay in the browser.
 */
export async function submitPhantomStart(
  runtime: MatchRuntime,
  opts: { commitmentHex: string; sessionToken?: string },
): Promise<void> {
  assertPhantomSession(runtime, opts.sessionToken);
  if (!runtime.pendingPhantomStart) {
    throw new BlackoutApiError(409, "this match is not waiting for a Phantom start commitment");
  }
  await runtime.client.setHiddenStart(runtime.refereeId, phantomSeatIndex(runtime), opts.commitmentHex);
  await runtime.client.start(runtime.refereeId);
  runtime.pendingPhantomStart = false;
  await saveMatch(runtime);
}

/**
 * Lands a browser-proven hidden move (M8.5): `{c_new, ticket, proof}` only —
 * the referee's on-chain verification is the sole legality check, exactly
 * as for the AI path (the server cannot check what it cannot see).
 */
export async function submitPhantomMove(
  runtime: MatchRuntime,
  opts: { cNewHex: string; ticket: number; proofHex: string; sessionToken?: string },
): Promise<{ round: number }> {
  assertPhantomSession(runtime, opts.sessionToken);
  const state = await runtime.client.gameState(runtime.refereeId);
  if (state.status !== "Active") {
    throw new BlackoutApiError(409, `match is not active (status: ${state.status})`);
  }
  const idx = phantomSeatIndex(runtime);
  if (state.current_player !== idx) {
    throw new BlackoutApiError(409, `it is not the Phantom's turn (current: ${state.current_player})`);
  }
  try {
    const tx = await runtime.client.submitHiddenMove(runtime.refereeId, {
      player: idx,
      cNewHex: opts.cNewHex,
      ticket: opts.ticket,
      proofHex: opts.proofHex,
    });
    runtime.lastProof = { ok: true, round: state.round, cNew: opts.cNewHex, at: Date.now() };
    runtime.log.push({
      type: "hidden_move",
      round: state.round,
      player: "phantom",
      to: null, // unknown to the server by design (browser-held secret)
      ticket: opts.ticket,
      txOk: true,
      at: Date.now(),
      tx,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    runtime.lastProof = { ok: false, round: state.round, error: message, at: Date.now() };
    runtime.log.push({ type: "error", message: `Phantom hidden move failed: ${message}`, at: Date.now() });
    await saveMatch(runtime);
    throw err;
  }
  await saveMatch(runtime);
  return { round: state.round };
}

/** Lands the browser's reveal `(node, salt)` at a reveal checkpoint (public by design at that moment). */
export async function submitPhantomReveal(
  runtime: MatchRuntime,
  opts: { node: number; saltHex: string; sessionToken?: string },
): Promise<void> {
  assertPhantomSession(runtime, opts.sessionToken);
  // The preceding phantom-move request just cached the chain state; the
  // round is only needed for the log entry, so avoid a dedicated read.
  const round =
    runtime.lastChainState?.round ?? (await runtime.client.gameState(runtime.refereeId)).round;
  const revealTx = await runtime.client.reveal(runtime.refereeId, {
    player: phantomSeatIndex(runtime),
    node: opts.node,
    saltHex: opts.saltHex,
  });
  runtime.log.push({ type: "reveal", round, player: "phantom", node: opts.node, at: Date.now(), tx: revealTx });
  await saveMatch(runtime);
}

/**
 * Validates and submits a human Investigator's public move (adjacency +
 * ticket ownership checked against the local mirror — the same legality the
 * on-chain referee enforces for hidden moves, though `submit_public_move`
 * itself does not check adjacency on-chain — see `runner.ts`'s
 * `scriptedCapture` doc comment), then updates the local mirror.
 */
export async function submitHumanMove(
  runtime: MatchRuntime,
  opts: { player: number; node: number; ticket: number; sessionToken?: string },
): Promise<void> {
  const { playerId, state } = await validateHumanMove(runtime, opts);
  const tx = await runtime.client.submitPublicMove(runtime.refereeId, { player: opts.player, node: opts.node, ticket: opts.ticket });
  recordHumanMove(runtime, playerId, state.round, { ...opts, tx });
  await saveMatch(runtime);
}

/** Shared status/turn/seat/legality validation for every human-move path. */
async function validateHumanMove(
  runtime: MatchRuntime,
  opts: { player: number; node: number; ticket: number; sessionToken?: string },
): Promise<{ playerId: PlayerId; state: ChainGameState }> {
  const state = await runtime.client.gameState(runtime.refereeId);
  if (state.status !== "Active") {
    throw new BlackoutApiError(409, `match is not active (status: ${state.status})`);
  }
  if (state.current_player !== opts.player) {
    throw new BlackoutApiError(409, `it is not player ${opts.player}'s turn (current: ${state.current_player})`);
  }
  const playerId = runtime.indexToPlayer.get(opts.player);
  if (!playerId) throw new BlackoutApiError(400, `unknown player index ${opts.player}`);
  if (runtime.agents.has(playerId)) {
    throw new BlackoutApiError(400, `player ${opts.player} ("${playerId}") is AI-controlled — use /ai-turn`);
  }
  const rosterEntry = runtime.roster.find((p) => p.id === playerId)!;
  if (rosterEntry.role !== "investigator") {
    throw new BlackoutApiError(400, "only Investigators submit public moves");
  }

  // Seat ownership (M8.4): a token-bound human seat only accepts its own
  // browser session. Unbound seats (legacy/demo flow) accept anyone.
  const seat = runtime.seats[playerId];
  if (seat?.token && seat.token !== opts.sessionToken) {
    throw new BlackoutApiError(403, `seat "${playerId}" belongs to a different session`);
  }

  const legalMoves = runtime.phantomHuman
    ? legalPublicMovesFromChain(state, opts.player)
    : runtime.local.view(playerId).legalMoves;
  const legal = legalMoves.some((m) => m.to === opts.node && m.ticket === opts.ticket);
  if (!legal) {
    throw new BlackoutApiError(
      400,
      `illegal move: node ${opts.node} / ticket ${opts.ticket} is not among this player's legal moves (${JSON.stringify(legalMoves)})`,
    );
  }
  return { playerId, state };
}

function recordHumanMove(
  runtime: MatchRuntime,
  playerId: PlayerId,
  round: number,
  opts: { node: number; ticket: number; tx?: string | null },
): void {
  // No engine mirror to advance in human-Phantom matches (see legal-moves.ts).
  if (!runtime.phantomHuman) {
    runtime.local.submit(playerId, { type: "move", to: opts.node, ticket: opts.ticket });
  }
  runtime.log.push({
    type: "public_move",
    round,
    player: playerId,
    to: opts.node,
    ticket: opts.ticket,
    txOk: true,
    at: Date.now(),
    tx: opts.tx ?? null,
  });
}

/**
 * Builds the unsigned `submit_public_move` envelope for the wallet-bound
 * human seat. The browser signs it with Freighter and posts it back to
 * `submitSignedHumanMove` — the server never holds the wallet's key.
 */
export async function prepareHumanMove(
  runtime: MatchRuntime,
  opts: { player: number; node: number; ticket: number; sessionToken?: string },
): Promise<{ xdr: string }> {
  if (!runtime.walletSeat || runtime.walletSeat.player !== opts.player) {
    throw new BlackoutApiError(400, `player ${opts.player} is not the wallet-bound seat — use POST /moves`);
  }
  await validateHumanMove(runtime, opts);
  const xdr = await buildUnsignedInvokeXdr({
    contractId: runtime.refereeId,
    network: runtime.network,
    sourceAccount: runtime.walletSeat.address,
    method: "submit_public_move",
    methodArgs: ["--player", String(opts.player), "--node", String(opts.node), "--ticket", String(opts.ticket)],
  });
  // Stash the prepared move server-side: submit records THIS, never
  // client-resent plaintext, so the log/mirror always match what was signed.
  runtime.pendingWalletMove = { player: opts.player, node: opts.node, ticket: opts.ticket, xdr };
  await saveMatch(runtime);
  return { xdr };
}

/** Lands a Freighter-signed `submit_public_move`, then mirrors it locally. */
export async function submitSignedHumanMove(
  runtime: MatchRuntime,
  opts: { player: number; node: number; ticket: number; signedXdr: string; sessionToken?: string },
): Promise<void> {
  const pending = runtime.pendingWalletMove;
  if (!pending) {
    throw new BlackoutApiError(409, "no prepared move to submit — call POST .../moves/prepare first");
  }
  if (pending.player !== opts.player || pending.node !== opts.node || pending.ticket !== opts.ticket) {
    throw new BlackoutApiError(
      400,
      "submitted move does not match the prepared one — re-prepare before signing a different move",
    );
  }
  const { playerId, state } = await validateHumanMove(runtime, { ...pending, sessionToken: opts.sessionToken });
  const tx = await sendSignedTx(runtime.network, opts.signedXdr);
  runtime.pendingWalletMove = undefined;
  recordHumanMove(runtime, playerId, state.round, { ...pending, tx });
  await saveMatch(runtime);
}

export type AdvanceAiTurnsResult = { movesPlayed: number };

/**
 * Drives every consecutive AI-controlled turn from wherever the match
 * currently sits: for the Phantom, this generates a fresh salt, a REAL
 * `BoardProver` UltraHonk proof, and submits `submit_hidden_move`
 * (ZK-verified on-chain); for an AI Investigator, a plain
 * `submit_public_move`. Stops the moment it's a human seat's turn (or the
 * match finishes), so it's safe to call after every human move and
 * whenever the client wants the AI to "just play" (e.g. an all-AI demo, or
 * the match opening on the Phantom's turn).
 */
export async function advanceAiTurns(
  runtime: MatchRuntime,
  opts: { maxSteps?: number } = {},
): Promise<AdvanceAiTurnsResult> {
  const maxSteps = opts.maxSteps ?? 30;
  const prover = new BoardProver();
  let movesPlayed = 0;

  for (let step = 0; step < maxSteps; step++) {
    const state: ChainGameState = await runtime.client.gameState(runtime.refereeId);
    runtime.lastChainState = state;
    if (state.status !== "Active") break;

    // Reveal ordering (M8.5): on a reveal round, a human Phantom that has
    // already moved must publish its reveal BEFORE investigators move —
    // capture resolves against their CURRENT positions. Hold all AI turns
    // until the browser's phantom-reveal lands.
    if (humanPhantomRevealPending(runtime, state)) break;

    const currentId = runtime.indexToPlayer.get(state.current_player);
    if (!currentId) {
      throw new Error(`advanceAiTurns: unknown current_player index ${state.current_player}`);
    }
    const agent = runtime.agents.get(currentId);
    if (!agent) break; // human's turn — stop and wait for /moves

    const rosterEntry = runtime.roster.find((p) => p.id === currentId)!;
    const view = runtime.phantomHuman
      ? chainAgentView(runtime, state, currentId)
      : runtime.local.view(currentId);
    if (view.legalMoves.length === 0) {
      throw new Error(`advanceAiTurns: no legal moves available for "${currentId}"`);
    }
    const move = await agent.act(view, view.legalMoves);
    const idx = runtime.playerIndex.get(currentId)!;
    const round = state.round;

    if (rosterEntry.role === "phantom") {
      if (!runtime.phantom) {
        throw new Error("advanceAiTurns: no server-held phantom secret for this match");
      }
      const newSalt = randomSalt();
      try {
        const proof = await prover.prove(cityGraphData, {
          from: runtime.phantom.pos,
          to: move.to as number,
          ticket: move.ticket as 0 | 1 | 2,
          saltOld: runtime.phantom.salt,
          saltNew: newSalt,
        });
        const tx = await runtime.client.submitHiddenMove(runtime.refereeId, {
          player: idx,
          cNewHex: proof.cNew,
          ticket: move.ticket as number,
          proofHex: Buffer.from(proof.proof).toString("hex"),
        });
        runtime.phantom = { pos: move.to as number, salt: newSalt };
        runtime.local.submit(currentId, move);
        runtime.local.setSecret(currentId, { pos: move.to });
        runtime.lastProof = { ok: true, round, cNew: proof.cNew, at: Date.now() };
        runtime.log.push({
          type: "hidden_move",
          round,
          player: currentId,
          to: move.to as number,
          ticket: move.ticket as number,
          txOk: true,
          at: Date.now(),
          tx,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        runtime.lastProof = { ok: false, round, error: message, at: Date.now() };
        runtime.log.push({ type: "error", message: `Phantom hidden move failed: ${message}`, at: Date.now() });
        await saveMatch(runtime);
        throw err;
      }
      // Persist IMMEDIATELY: the hidden move (and the rotated phantom salt)
      // are on-chain now — losing this write would brick every future proof.
      await saveMatch(runtime);

      const revealRounds = runtime.config.revealRounds ?? DEFAULT_REVEAL_ROUNDS;
      if (revealRounds.includes(round)) {
        const revealTx = await runtime.client.reveal(runtime.refereeId, {
          player: idx,
          node: runtime.phantom.pos,
          saltHex: toBe32Hex(runtime.phantom.salt),
        });
        runtime.log.push({ type: "reveal", round, player: currentId, node: runtime.phantom.pos, at: Date.now(), tx: revealTx });
        await saveMatch(runtime);
      }
    } else {
      const tx = await runtime.client.submitPublicMove(runtime.refereeId, {
        player: idx,
        node: move.to as number,
        ticket: move.ticket as number,
      });
      if (!runtime.phantomHuman) runtime.local.submit(currentId, move);
      runtime.log.push({
        type: "public_move",
        round,
        player: currentId,
        to: move.to as number,
        ticket: move.ticket as number,
        txOk: true,
        at: Date.now(),
        tx,
      });
      // Persist each landed on-chain move: a later-iteration failure must
      // not leave the durable record behind the chain.
      await saveMatch(runtime);
    }

    movesPlayed++;
  }

  return { movesPlayed };
}

/** True while a human Phantom's reveal for the current round is still due. */
function humanPhantomRevealPending(runtime: MatchRuntime, state: ChainGameState): boolean {
  if (!runtime.phantomHuman) return false;
  const phantomIdx = runtime.playerIndex.get("phantom");
  if (phantomIdx === undefined || state.current_player === phantomIdx) return false; // phantom hasn't moved yet
  const revealRounds = runtime.config.revealRounds ?? DEFAULT_REVEAL_ROUNDS;
  if (!revealRounds.includes(state.round)) return false;
  return !state.reveal_log.some(([round]) => round === state.round);
}

/**
 * Faithful `PlayerView` for an AI investigator built from CHAIN state
 * (M8.5): human-Phantom matches keep no engine mirror, and a frozen mirror
 * view would leave agents reasoning from round-0 positions with no reveals.
 * Field-for-field the shape `blackout`'s public state/agents expect.
 */
function chainAgentView(runtime: MatchRuntime, state: ChainGameState, playerId: PlayerId): PlayerView {
  const idx = runtime.playerIndex.get(playerId)!;
  const chainPlayer = state.players[idx];
  const [taxi, bus, rail] = chainPlayer?.resources ?? [0, 0, 0];

  const investigatorNodes: Record<PlayerId, number> = {};
  for (const p of runtime.roster) {
    if (p.role !== "investigator") continue;
    const node = state.players[runtime.playerIndex.get(p.id)!]?.public_node;
    if (node !== null && node !== undefined) investigatorNodes[p.id] = node;
  }

  return {
    public: {
      round: state.round,
      nRounds: runtime.config.nRounds ?? DEFAULT_N_ROUNDS,
      revealRounds: runtime.config.revealRounds ?? DEFAULT_REVEAL_ROUNDS,
      ticketFeed: state.ticket_feed,
      revealLog: state.reveal_log.map(([round, node]) => ({ round, node })),
      investigatorNodes,
    },
    self: { id: playerId, role: "investigator", secret: {} },
    tickets: { taxi, bus, rail },
    legalMoves: legalPublicMovesFromChain(state, idx),
  };
}
