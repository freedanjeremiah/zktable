// Pure state -> DTO mapping: turns a `ChainGameState` (from
// `CliRefereeClient.gameState`) plus the bits of `MatchRuntime` needed for
// context into the JSON shape the API routes return to the browser. No I/O
// here — `orchestrator.ts` does the (async) chain read and calls this.

import { CITY } from "@zktable/blackout";
import type { ChainGameState, Role, Roster } from "@zktable/blackout";
import type { Move, PlayerId, PlayerView } from "@zktable/core";
import type { MatchEvent, ProofStatus } from "./match-store";

export type MatchDtoPlayer = {
  index: number;
  id: PlayerId;
  role: Role;
  /** Public position — null for the Phantom until its first reveal. */
  node: number | null;
  isAi: boolean;
  alive: boolean;
  tickets: { taxi: number; bus: number; rail: number };
};

export type MatchDtoCurrentPlayer = {
  index: number;
  id: PlayerId;
  role: Role;
  isAi: boolean;
  /** Only present when it's a human seat's turn — the exact legal moves
   *  (adjacency + ticket-filtered) the client can submit right now. */
  legalMoves?: Move[];
};

export type MatchDtoOutcome = { role: Role; playerIds: PlayerId[] };

export type MatchDto = {
  matchId: string;
  refereeId: string;
  verifierId: string;
  explorerUrl: string;
  status: "lobby" | "active" | "finished";
  round: number;
  currentPlayer: MatchDtoCurrentPlayer | null;
  players: MatchDtoPlayer[];
  ticketFeed: number[];
  revealLog: Array<{ round: number; node: number }>;
  outcome: MatchDtoOutcome | null;
  proofStatus: ProofStatus | null;
  log: MatchEvent[];
  mapMeta: { name: string; nodeCount: number };
};

/** The subset of `MatchRuntime` `toDto` needs — kept narrow so this stays unit-testable. */
export type DtoContext = {
  id: string;
  refereeId: string;
  verifierId: string;
  explorerUrl: string;
  roster: Roster;
  playerIndex: Map<PlayerId, number>;
  indexToPlayer: Map<number, PlayerId>;
  agents: Map<PlayerId, unknown>;
  local: { view(id: PlayerId): PlayerView };
  log: MatchEvent[];
  lastProof?: ProofStatus;
};

export function toDto(state: ChainGameState, ctx: DtoContext): MatchDto {
  const players: MatchDtoPlayer[] = ctx.roster.map((p) => {
    const index = ctx.playerIndex.get(p.id)!;
    const chainPlayer = state.players[index];
    const [taxi, bus, rail] = chainPlayer?.resources ?? [0, 0, 0];
    return {
      index,
      id: p.id,
      role: p.role,
      node: chainPlayer?.public_node ?? null,
      isAi: ctx.agents.has(p.id),
      alive: true,
      tickets: { taxi, bus, rail },
    };
  });

  const currentId = ctx.indexToPlayer.get(state.current_player);
  const currentRoster = currentId ? ctx.roster.find((p) => p.id === currentId) : undefined;
  const currentIsAi = currentId ? ctx.agents.has(currentId) : true;
  const currentPlayer: MatchDtoCurrentPlayer | null =
    currentId && currentRoster
      ? {
          index: state.current_player,
          id: currentId,
          role: currentRoster.role,
          isAi: currentIsAi,
          legalMoves: currentIsAi ? undefined : ctx.local.view(currentId).legalMoves,
        }
      : null;

  const outcome: MatchDtoOutcome | null =
    state.outcome === null || state.outcome === undefined
      ? null
      : {
          role: state.outcome,
          playerIds: players.filter((p) => p.role === state.outcome).map((p) => p.id),
        };

  return {
    matchId: ctx.id,
    refereeId: ctx.refereeId,
    verifierId: ctx.verifierId,
    explorerUrl: ctx.explorerUrl,
    status: state.status.toLowerCase() as MatchDto["status"],
    round: state.round,
    currentPlayer,
    players,
    ticketFeed: state.ticket_feed,
    revealLog: state.reveal_log.map(([round, node]) => ({ round, node })),
    outcome,
    proofStatus: ctx.lastProof ?? null,
    log: ctx.log,
    mapMeta: { name: CITY.name, nodeCount: CITY.nodes.length },
  };
}
