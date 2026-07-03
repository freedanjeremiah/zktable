// MatchRecord (M8.4): the serializable mirror of `MatchRuntime`, and the
// hydration that rebuilds a live runtime from it. Everything in the runtime
// is reconstructible from plain data plus the workspace's own constants —
// the only true secrets are the Phantom's (pos, salt), serialized
// explicitly; the local `Match` mirror is rebuilt by REPLAYING the match's
// own event log through a fresh engine instance (the log records every
// move that ever reached the chain).

import type { Agent } from "@zktable/agents";
import { BoardGraph } from "@zktable/circuits";
import type { PlayerId } from "@zktable/core";
import {
  CliRefereeClient,
  cityGraphData,
  createLocalMatch,
  toBe32Hex,
} from "@zktable/blackout";
import type { BlackoutConfig, Roster } from "@zktable/blackout";
import type { MatchEvent, MatchRuntime, ProofStatus, SeatBinding } from "./match-store";

/** Bumped on any breaking shape change; hydrate refuses newer versions. */
export const MATCH_RECORD_VERSION = 1;

export type AgentSeat = { role: "phantom" | "investigator"; model?: string };

export type MatchRecord = {
  version: number;
  id: string;
  refereeId: string;
  verifierId: string;
  network: string;
  source: string;
  roster: Roster;
  playerIndexEntries: Array<[PlayerId, number]>;
  phantom: { pos: number; saltHex: string } | null;
  agentSeats: Record<PlayerId, AgentSeat>;
  config: BlackoutConfig;
  explorerUrl: string;
  createdAt: number;
  updatedAt: number;
  localSeed: string;
  log: MatchEvent[];
  lastProof?: ProofStatus;
  walletSeat?: { player: number; address: string };
  pendingStart?: { player: number; node: number; xdr: string };
  seats: Record<PlayerId, SeatBinding>;
  open: boolean;
  phantomHuman: boolean;
  pendingPhantomStart: boolean;
};

export function toRecord(runtime: MatchRuntime): MatchRecord {
  const agentSeats: Record<PlayerId, AgentSeat> = {};
  for (const [id] of runtime.agents) {
    const rosterEntry = runtime.roster.find((p) => p.id === id)!;
    agentSeats[id] = { role: rosterEntry.role, model: runtime.model };
  }
  return {
    version: MATCH_RECORD_VERSION,
    id: runtime.id,
    refereeId: runtime.refereeId,
    verifierId: runtime.verifierId,
    network: runtime.network,
    source: runtime.source,
    roster: runtime.roster,
    playerIndexEntries: [...runtime.playerIndex.entries()],
    phantom: runtime.phantom ? { pos: runtime.phantom.pos, saltHex: toBe32Hex(runtime.phantom.salt) } : null,
    agentSeats,
    config: runtime.config,
    explorerUrl: runtime.explorerUrl,
    createdAt: runtime.createdAt,
    updatedAt: Date.now(),
    localSeed: runtime.localSeed,
    log: runtime.log,
    lastProof: runtime.lastProof,
    walletSeat: runtime.walletSeat,
    pendingStart: runtime.pendingStart,
    seats: runtime.seats,
    open: runtime.open,
    phantomHuman: runtime.phantomHuman,
    pendingPhantomStart: runtime.pendingPhantomStart,
  };
}

/**
 * Rebuilds a live `MatchRuntime` from a record: fresh client/graph/agents,
 * then a fresh local `Match` brought back into lockstep by replaying every
 * logged move (hidden moves also restore the Phantom's tracked secret so
 * `view()` and legal-move prediction keep working).
 */
export function hydrateRecord(
  record: MatchRecord,
  buildAgent: (model: string | undefined, role: "phantom" | "investigator") => Agent,
): MatchRuntime {
  if (record.version > MATCH_RECORD_VERSION) {
    throw new Error(
      `match record ${record.id} has version ${record.version}, newer than this server understands (${MATCH_RECORD_VERSION})`,
    );
  }

  const local = createLocalMatch(record.roster, record.config, record.localSeed);
  // Human-Phantom matches (M8.5) have no mirror to rebuild: the server
  // never sees the Phantom's moves, so the log cannot be replayed. The
  // fresh mirror is left untouched (and unused — legality comes from the
  // public graph instead, see legal-moves.ts).
  for (const event of record.phantomHuman ? [] : record.log) {
    if (event.type === "public_move") {
      local.submit(event.player, { type: "move", to: event.to, ticket: event.ticket });
    } else if (event.type === "hidden_move") {
      local.submit(event.player, { type: "move", to: event.to, ticket: event.ticket });
      local.setSecret(event.player, { pos: event.to });
    }
    // "reveal" / "error" events carry no local state transition.
  }

  const agents = new Map<PlayerId, Agent>();
  for (const [id, seat] of Object.entries(record.agentSeats)) {
    agents.set(id, buildAgent(seat.model, seat.role));
  }

  return {
    id: record.id,
    refereeId: record.refereeId,
    verifierId: record.verifierId,
    client: new CliRefereeClient({ network: record.network, source: record.source }),
    graph: new BoardGraph(cityGraphData),
    local,
    roster: record.roster,
    playerIndex: new Map(record.playerIndexEntries),
    indexToPlayer: new Map(record.playerIndexEntries.map(([id, idx]) => [idx, id])),
    phantom: record.phantom ? { pos: record.phantom.pos, salt: BigInt(`0x${record.phantom.saltHex}`) } : null,
    agents,
    model: Object.values(record.agentSeats)[0]?.model,
    config: record.config,
    explorerUrl: record.explorerUrl,
    network: record.network,
    source: record.source,
    createdAt: record.createdAt,
    localSeed: record.localSeed,
    log: [...record.log],
    lastProof: record.lastProof,
    walletSeat: record.walletSeat,
    pendingStart: record.pendingStart,
    seats: { ...record.seats },
    open: record.open,
    phantomHuman: record.phantomHuman,
    pendingPhantomStart: record.pendingPhantomStart,
  };
}
