import { describe, expect, it } from "vitest";
import type { PlayerView } from "@zktable/core";
import type { ChainGameState } from "@zktable/blackout";
import type { DtoContext } from "./dto";
import { toDto } from "./dto";

function baseState(overrides: Partial<ChainGameState> = {}): ChainGameState {
  return {
    status: "Active",
    round: 4,
    turn_index: 1,
    current_player: 1,
    ticket_feed: [0, 1, 2],
    reveal_log: [[3, 17]],
    players: [
      { address: "G_PHANTOM", role: "phantom", public_node: null, hidden_commitment: "abcd", resources: [23, 24, 24] },
      { address: "G_INV1", role: "investigator", public_node: 55, hidden_commitment: null, resources: [24, 23, 24] },
      { address: "G_INV2", role: "investigator", public_node: 80, hidden_commitment: null, resources: [24, 24, 23] },
    ],
    outcome: null,
    ...overrides,
  };
}

function baseCtx(overrides: Partial<DtoContext> = {}): DtoContext {
  const roster = [
    { id: "phantom", role: "phantom" as const },
    { id: "investigator1", role: "investigator" as const },
    { id: "investigator2", role: "investigator" as const },
  ];
  const playerIndex = new Map([
    ["phantom", 0],
    ["investigator1", 1],
    ["investigator2", 2],
  ]);
  const indexToPlayer = new Map([
    [0, "phantom"],
    [1, "investigator1"],
    [2, "investigator2"],
  ]);
  // investigator2 is AI-controlled; phantom is always AI; investigator1 is human.
  const agents = new Map<string, object>([
    ["phantom", {}],
    ["investigator2", {}],
  ]);
  const legalMovesByPlayer: Record<string, PlayerView["legalMoves"]> = {
    investigator1: [{ type: "move", to: 56, ticket: 0 }],
  };
  const local = {
    view: (id: string): PlayerView => ({
      public: {},
      self: { id, secret: {} },
      tickets: {},
      legalMoves: legalMovesByPlayer[id] ?? [],
    }),
  };
  return {
    id: "match-1",
    refereeId: "CREFEREE",
    verifierId: "CVERIFIER",
    explorerUrl: "https://stellar.expert/explorer/testnet/contract/CREFEREE",
    roster,
    playerIndex,
    indexToPlayer,
    agents,
    local,
    log: [],
    ...overrides,
  };
}

describe("toDto", () => {
  it("lowercases status and passes through round/ticketFeed", () => {
    const dto = toDto(baseState({ status: "Active", round: 4, ticket_feed: [0, 1] }), baseCtx());
    expect(dto.status).toBe("active");
    expect(dto.round).toBe(4);
    expect(dto.ticketFeed).toEqual([0, 1]);
  });

  it("maps reveal_log tuples to { round, node } objects", () => {
    const dto = toDto(baseState({ reveal_log: [[3, 17], [8, 42]] }), baseCtx());
    expect(dto.revealLog).toEqual([
      { round: 3, node: 17 },
      { round: 8, node: 42 },
    ]);
  });

  it("maps each chain player to a DTO player with node, role, isAi, and tickets", () => {
    const dto = toDto(baseState(), baseCtx());
    expect(dto.players).toEqual([
      { index: 0, id: "phantom", role: "phantom", node: null, isAi: true, alive: true, tickets: { taxi: 23, bus: 24, rail: 24 } },
      { index: 1, id: "investigator1", role: "investigator", node: 55, isAi: false, alive: true, tickets: { taxi: 24, bus: 23, rail: 24 } },
      { index: 2, id: "investigator2", role: "investigator", node: 80, isAi: true, alive: true, tickets: { taxi: 24, bus: 24, rail: 23 } },
    ]);
  });

  it("exposes the phantom's revealed node once public_node is set", () => {
    const state = baseState();
    state.players[0]!.public_node = 17;
    const dto = toDto(state, baseCtx());
    expect(dto.players[0]!.node).toBe(17);
  });

  it("includes legalMoves on currentPlayer only when it is a human's turn", () => {
    const human = toDto(baseState({ current_player: 1 }), baseCtx());
    expect(human.currentPlayer).toEqual({
      index: 1,
      id: "investigator1",
      role: "investigator",
      isAi: false,
      legalMoves: [{ type: "move", to: 56, ticket: 0 }],
    });

    const ai = toDto(baseState({ current_player: 0 }), baseCtx());
    expect(ai.currentPlayer?.isAi).toBe(true);
    expect(ai.currentPlayer?.legalMoves).toBeUndefined();
  });

  it("resolves outcome to a role + the winning player ids", () => {
    const investigatorsWin = toDto(baseState({ outcome: "investigator" }), baseCtx());
    expect(investigatorsWin.outcome).toEqual({ role: "investigator", playerIds: ["investigator1", "investigator2"] });

    const phantomWins = toDto(baseState({ outcome: "phantom" }), baseCtx());
    expect(phantomWins.outcome).toEqual({ role: "phantom", playerIds: ["phantom"] });

    const undecided = toDto(baseState({ outcome: null }), baseCtx());
    expect(undecided.outcome).toBeNull();
  });

  it("passes through lastProof as proofStatus, and log verbatim", () => {
    const proof = { ok: true, round: 3, cNew: "0xdead", at: 123 };
    const events = [{ type: "reveal" as const, round: 3, player: "phantom", node: 17, at: 456 }];
    const dto = toDto(baseState(), baseCtx({ lastProof: proof, log: events }));
    expect(dto.proofStatus).toEqual(proof);
    expect(dto.log).toEqual(events);
  });

  it("carries match/referee/verifier ids and a mapMeta with a positive node count", () => {
    const dto = toDto(baseState(), baseCtx());
    expect(dto.matchId).toBe("match-1");
    expect(dto.refereeId).toBe("CREFEREE");
    expect(dto.verifierId).toBe("CVERIFIER");
    expect(dto.mapMeta.nodeCount).toBeGreaterThan(0);
  });
});
