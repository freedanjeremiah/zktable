// Durable match store (M8.4): matches are persisted as serializable
// `MatchRecord`s behind a small async `MatchStore` interface — the
// in-memory backend keeps the old single-process demo behavior (attached
// to `globalThis` so it survives Next.js dev-server module reloads), and
// the Redis backend (selected by `REDIS_URL`) makes matches survive
// restarts and be visible across instances. Live `MatchRuntime`s are
// hydrated on demand (event-log replay — see `match-record.ts`) and kept
// in a per-process cache keyed by `id:updatedAt`.
//
// Single-writer-per-match is assumed (the orchestrator's request flow
// already serializes writes per match in practice); `updatedAt` exists so
// a stale hydration is detected and replaced, not silently reused.

import type { BoardGraph } from "@zktable/circuits";
import type { Match, Move, PlayerId, Role } from "@zktable/core";
import type { BlackoutConfig, ChainGameState, CliRefereeClient, Roster } from "@zktable/blackout";
import type { Agent } from "@zktable/agents";
import type { MatchRecord } from "./match-record";

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

/** Who may act for a human seat: the browser session holding `token`. AI seats have no binding. */
export type SeatBinding = { token?: string; open: boolean };

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
  /** The Phantom's real secret (position + salt) — server-side only; null
   *  for future human-phantom matches where the browser holds it. */
  phantom: { pos: number; salt: bigint } | null;
  /** AI-controlled seats (Phantom always; 0+ AI Investigators). Any roster
   *  id NOT in this map is a human seat. */
  agents: Map<PlayerId, Agent>;
  /** Claude model override used when building agents (recorded for rehydration). */
  model?: string;
  config: BlackoutConfig;
  explorerUrl: string;
  network: string;
  source: string;
  createdAt: number;
  /** Seed the local mirror was created with — replay needs the same one. */
  localSeed: string;
  log: MatchEvent[];
  lastProof?: ProofStatus;
  /** Cached last-seen chain state, updated whenever we fetch it — lets the
   *  DTO builder avoid a redundant `game_state` read right after a move. */
  lastChainState?: ChainGameState;
  /** Wallet-bound human seat (Freighter): the referee's require_auth() binds
   *  this seat to `address`, so its moves go prepare -> sign -> submit. */
  walletSeat?: { player: number; address: string };
  /** Unsigned `set_public_start` envelope awaiting the wallet's signature —
   *  the match stays in Lobby (start() deferred) until it lands. */
  pendingStart?: { player: number; node: number; xdr: string };
  /** Per-human-seat session binding (M8.4). */
  seats: Record<PlayerId, SeatBinding>;
  /** Listed in the open-match lobby while a human seat is unclaimed. */
  open: boolean;
  /** The Phantom seat is a HUMAN proving in their browser (M8.5): the
   *  server holds no phantom secret and keeps no engine mirror. */
  phantomHuman: boolean;
  /** Waiting for the browser to commit the Phantom's hidden start. */
  pendingPhantomStart: boolean;
};

export type MatchSummary = {
  id: string;
  createdAt: number;
  refereeId: string;
  openSeats: PlayerId[];
};

/** The narrow persistence interface (spec M8.4). */
export interface MatchStore {
  save(record: MatchRecord): Promise<void>;
  load(id: string): Promise<MatchRecord | null>;
  listOpen(): Promise<MatchRecord[]>;
  delete(id: string): Promise<void>;
}

// --- memory backend ---------------------------------------------------

const RECORDS_KEY = "__zktableBlackoutMatchRecords__";

function recordMap(): Map<string, MatchRecord> {
  const g = globalThis as unknown as Record<string, Map<string, MatchRecord> | undefined>;
  if (!g[RECORDS_KEY]) g[RECORDS_KEY] = new Map();
  return g[RECORDS_KEY]!;
}

export class MemoryMatchStore implements MatchStore {
  async save(record: MatchRecord): Promise<void> {
    recordMap().set(record.id, record);
  }
  async load(id: string): Promise<MatchRecord | null> {
    return recordMap().get(id) ?? null;
  }
  async listOpen(): Promise<MatchRecord[]> {
    return [...recordMap().values()].filter((r) => r.open);
  }
  async delete(id: string): Promise<void> {
    recordMap().delete(id);
  }
}

// --- redis backend ------------------------------------------------------

const MATCH_KEY_PREFIX = "zktable:match:";
const OPEN_SET_KEY = "zktable:open-matches";
/** Matches evaporate a day after their last write — solves unbounded growth. */
const MATCH_TTL_SECONDS = 24 * 60 * 60;

/** The subset of ioredis this store uses — injectable for tests. */
export type RedisLike = {
  set(key: string, value: string, ex: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
};

export class RedisMatchStore implements MatchStore {
  constructor(private readonly redis: RedisLike) {}

  static async connect(url: string): Promise<RedisMatchStore> {
    const { default: Redis } = await import("ioredis");
    return new RedisMatchStore(new Redis(url) as unknown as RedisLike);
  }

  async save(record: MatchRecord): Promise<void> {
    await this.redis.set(MATCH_KEY_PREFIX + record.id, JSON.stringify(record), "EX", MATCH_TTL_SECONDS);
    if (record.open) {
      await this.redis.sadd(OPEN_SET_KEY, record.id);
    } else {
      await this.redis.srem(OPEN_SET_KEY, record.id);
    }
  }

  async load(id: string): Promise<MatchRecord | null> {
    const raw = await this.redis.get(MATCH_KEY_PREFIX + id);
    return raw ? (JSON.parse(raw) as MatchRecord) : null;
  }

  async listOpen(): Promise<MatchRecord[]> {
    const ids = await this.redis.smembers(OPEN_SET_KEY);
    const out: MatchRecord[] = [];
    for (const id of ids) {
      const record = await this.load(id);
      if (record?.open) out.push(record);
      else await this.redis.srem(OPEN_SET_KEY, id); // expired or closed — tidy the index
    }
    return out;
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(MATCH_KEY_PREFIX + id);
    await this.redis.srem(OPEN_SET_KEY, id);
  }
}

// --- store selection ------------------------------------------------------

const STORE_KEY = "__zktableBlackoutMatchStore__";

/** `REDIS_URL` set ⇒ durable Redis store; otherwise the in-process map. */
export async function resolveStore(): Promise<MatchStore> {
  const g = globalThis as unknown as Record<string, MatchStore | Promise<MatchStore> | undefined>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = process.env.REDIS_URL
      ? RedisMatchStore.connect(process.env.REDIS_URL)
      : Promise.resolve(new MemoryMatchStore());
  }
  return g[STORE_KEY]!;
}

/** Test-only: force a specific backend (and clear the hydration cache). */
export function setStoreForTesting(store: MatchStore | undefined): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g[STORE_KEY] = store ? Promise.resolve(store) : undefined;
  hydrationCache().clear();
}

// --- runtime save/load (hydration cache) -----------------------------------

type CacheEntry = { updatedAt: number; runtime: MatchRuntime };
const CACHE_KEY = "__zktableBlackoutRuntimeCache__";

function hydrationCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as Record<string, Map<string, CacheEntry> | undefined>;
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map();
  return g[CACHE_KEY]!;
}

type BuildAgent = (model: string | undefined, role: "phantom" | "investigator") => Agent;

export async function saveMatch(runtime: MatchRuntime): Promise<void> {
  const { toRecord } = await import("./match-record");
  const record = toRecord(runtime);
  const store = await resolveStore();
  await store.save(record);
  hydrationCache().set(runtime.id, { updatedAt: record.updatedAt, runtime });
}

export async function getMatch(id: string, buildAgent: BuildAgent): Promise<MatchRuntime | undefined> {
  const store = await resolveStore();
  const record = await store.load(id);
  if (!record) {
    hydrationCache().delete(id);
    return undefined;
  }
  const cached = hydrationCache().get(id);
  if (cached && cached.updatedAt === record.updatedAt) {
    return cached.runtime;
  }
  const { hydrateRecord } = await import("./match-record");
  const runtime = hydrateRecord(record, buildAgent);
  hydrationCache().set(id, { updatedAt: record.updatedAt, runtime });
  return runtime;
}

export async function listOpenMatches(): Promise<MatchSummary[]> {
  const store = await resolveStore();
  const records = await store.listOpen();
  return records
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      refereeId: r.refereeId,
      openSeats: Object.entries(r.seats)
        .filter(([, seat]) => seat.open && !seat.token)
        .map(([playerId]) => playerId),
    }));
}

export type { Move, Role };
