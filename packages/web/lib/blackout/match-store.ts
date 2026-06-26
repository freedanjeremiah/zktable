// In-memory match store: `Map<matchId, MatchRuntime>`. Fine for a
// single-server demo (M4b) — not durable, not multi-instance. Attached to
// `globalThis` so it survives Next.js dev-server module reloads (the same
// trick commonly used to avoid re-instantiating a Prisma client per Fast
// Refresh); a production deploy would swap this for a real store without
// touching the orchestrator's public API.

import type { BoardGraph } from "@zktable/circuits";
import type { Match, Move, PlayerId, Role } from "@zktable/core";
import type { BlackoutConfig, ChainGameState, CliRefereeClient, Roster } from "@zktable/blackout";
import type { Agent } from "@zktable/agents";

export type ProofStatus = {
  ok: boolean;
  round: number;
  cNew?: string;
  error?: string;
  at: number;
};

export type MatchEvent =
  | { type: "hidden_move"; round: number; player: PlayerId; to: number; ticket: number; txOk: boolean; at: number }
  | { type: "public_move"; round: number; player: PlayerId; to: number; ticket: number; txOk: boolean; at: number }
  | { type: "reveal"; round: number; player: PlayerId; node: number; at: number }
  | { type: "error"; message: string; at: number };

/** Everything the orchestrator needs to keep driving one live match. */
export type MatchRuntime = {
  id: string;
  refereeId: string;
  verifierId: string;
  client: CliRefereeClient;
  graph: BoardGraph;
  /** Local `@zktable/core` `Match` mirror — same roster/config/turn order as
   *  the on-chain referee, kept in lockstep move-for-move so `view()` can
   *  cheaply derive legal moves without a chain round-trip. */
  local: Match;
  roster: Roster;
  playerIndex: Map<PlayerId, number>;
  indexToPlayer: Map<number, PlayerId>;
  /** The Phantom's real secret (position + salt) — server-side only. */
  phantom: { pos: number; salt: bigint };
  /** AI-controlled seats (Phantom always; 0+ AI Investigators). Any roster
   *  id NOT in this map is a human seat. */
  agents: Map<PlayerId, Agent>;
  config: BlackoutConfig;
  explorerUrl: string;
  network: string;
  source: string;
  createdAt: number;
  log: MatchEvent[];
  lastProof?: ProofStatus;
  /** Cached last-seen chain state, updated whenever we fetch it — lets the
   *  DTO builder avoid a redundant `game_state` read right after a move. */
  lastChainState?: ChainGameState;
};

type Store = Map<string, MatchRuntime>;

const GLOBAL_KEY = "__zktableBlackoutMatchStore__";

function getStore(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
  return g[GLOBAL_KEY]!;
}

export function saveMatch(runtime: MatchRuntime): void {
  getStore().set(runtime.id, runtime);
}

export function getMatch(id: string): MatchRuntime | undefined {
  return getStore().get(id);
}

export function listMatchIds(): string[] {
  return [...getStore().keys()];
}

export type { Move, Role };
