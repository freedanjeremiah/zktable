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
  // `to` is null when the position is browser-held (human Phantom, M8.5) —
  // the server never learns it, and consumers must not treat it as a node.
  | { type: "hidden_move"; round: number; player: PlayerId; to: number | null; ticket: number; txOk: boolean; at: number; tx?: string | null }
  | { type: "public_move"; round: number; player: PlayerId; to: number; ticket: number; txOk: boolean; at: number; tx?: string | null }
  | { type: "reveal"; round: number; player: PlayerId; node: number; at: number; tx?: string | null }
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
  /** The wallet seat's prepared-but-unsigned move: the server records THIS
   *  (not client-resent plaintext) when the signed envelope lands, so the
   *  log/mirror can never diverge from what was actually signed. */
  pendingWalletMove?: { player: number; node: number; ticket: number; xdr: string };
  /** Optimistic-concurrency revision — incremented on every save; the store
   *  rejects a save whose base revision is stale (lost-update guard). */
  revision?: number;
};

export type MatchSummary = {
  id: string;
  createdAt: number;
  refereeId: string;
  openSeats: PlayerId[];
  /** 'lobby' while a start (wallet or phantom) is still pending, else 'active'. */
  status: "lobby" | "active";
};

/** Thrown by a store when a save's base revision is stale (concurrent writer won). */
export class StoreConflictError extends Error {
  constructor(id: string) {
    super(`match ${id} was updated concurrently`);
    this.name = "StoreConflictError";
  }
}

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
    const stored = recordMap().get(record.id);
    if ((stored?.revision ?? 0) !== record.revision - 1) {
      throw new StoreConflictError(record.id);
    }
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
/** Matches evaporate a week after their last write — long enough to resume a
 *  bookmarked match (its contracts stay live on testnet), short enough to
 *  solve unbounded growth. */
const MATCH_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Compare-and-set save: rejects unless the stored record's revision equals
 *  the incoming record's revision - 1 (missing record counts as revision 0). */
const CAS_SAVE_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ok, obj = pcall(cjson.decode, cur)
  local rev = 0
  if ok and type(obj) == 'table' and obj.revision then rev = obj.revision end
  if rev ~= tonumber(ARGV[2]) then return 0 end
elseif tonumber(ARGV[2]) ~= 0 then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

/** The subset of ioredis this store uses — injectable for tests. */
export type RedisLike = {
  set(key: string, value: string, ex: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  sadd(key: string, member: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
  smembers(key: string): Promise<string[]>;
  eval(script: string, numKeys: number, ...keysAndArgs: Array<string | number>): Promise<unknown>;
};

export class RedisMatchStore implements MatchStore {
  constructor(private readonly redis: RedisLike) {}

  static async connect(url: string): Promise<RedisMatchStore> {
    const { default: Redis } = await import("ioredis");
    // Bounded failure, not infinite buffering: a down Redis must surface as
    // an error the routes can turn into a 503, not a hung request.
    const redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
    });
    return new RedisMatchStore(redis as unknown as RedisLike);
  }

  async save(record: MatchRecord): Promise<void> {
    const landed = await this.redis.eval(
      CAS_SAVE_LUA,
      1,
      MATCH_KEY_PREFIX + record.id,
      JSON.stringify(record),
      record.revision - 1,
      MATCH_TTL_SECONDS,
    );
    if (landed !== 1) throw new StoreConflictError(record.id);
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
    const loaded = await Promise.all(ids.map(async (id) => ({ id, record: await this.load(id) })));
    const out: MatchRecord[] = [];
    await Promise.all(
      loaded.map(async ({ id, record }) => {
        if (record?.open) out.push(record);
        else await this.redis.srem(OPEN_SET_KEY, id); // expired or closed — tidy the index
      }),
    );
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
    const pending = process.env.REDIS_URL
      ? RedisMatchStore.connect(process.env.REDIS_URL)
      : Promise.resolve(new MemoryMatchStore());
    g[STORE_KEY] = pending;
    // A failed connect must not be memoized forever — clear the slot so the
    // next request retries instead of re-awaiting the same rejection.
    void Promise.resolve(pending).catch(() => {
      if (g[STORE_KEY] === pending) g[STORE_KEY] = undefined;
    });
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

/** Maps store/backing failures to HTTP-meaningful errors (409 conflict, 503 unavailable). */
async function withStoreErrors<T>(op: () => Promise<T>): Promise<T> {
  const { BlackoutApiError } = await import("./errors");
  try {
    return await op();
  } catch (err) {
    if (err instanceof StoreConflictError) {
      throw new BlackoutApiError(409, "match was updated concurrently — refetch and retry");
    }
    if (err instanceof BlackoutApiError) throw err;
    console.error("[match-store] store operation failed:", err);
    throw new BlackoutApiError(503, "match store unavailable");
  }
}

export async function saveMatch(runtime: MatchRuntime): Promise<void> {
  const { toRecord } = await import("./match-record");
  runtime.revision = (runtime.revision ?? 0) + 1;
  const record = toRecord(runtime);
  try {
    await withStoreErrors(async () => {
      const store = await resolveStore();
      await store.save(record);
    });
  } catch (err) {
    // This runtime lost the race (or the store is down) — drop it from the
    // cache so the next request rehydrates the winning record.
    hydrationCache().delete(runtime.id);
    throw err;
  }
  hydrationCache().set(runtime.id, { updatedAt: record.updatedAt, runtime });
}

export async function getMatch(id: string, buildAgent: BuildAgent): Promise<MatchRuntime | undefined> {
  const record = await withStoreErrors(async () => {
    const store = await resolveStore();
    return store.load(id);
  });
  if (!record) {
    hydrationCache().delete(id);
    return undefined;
  }
  const cached = hydrationCache().get(id);
  if (cached && cached.updatedAt === record.updatedAt) {
    return cached.runtime;
  }
  const { hydrateRecord } = await import("./match-record");
  try {
    const runtime = hydrateRecord(record, buildAgent);
    hydrationCache().set(id, { updatedAt: record.updatedAt, runtime });
    return runtime;
  } catch (err) {
    console.error(`[match-store] failed to hydrate match ${id} (record v${record.version}):`, err);
    throw err;
  }
}

export async function listOpenMatches(): Promise<MatchSummary[]> {
  const records = await withStoreErrors(async () => {
    const store = await resolveStore();
    return store.listOpen();
  });
  return records
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      refereeId: r.refereeId,
      openSeats: Object.entries(r.seats)
        .filter(([, seat]) => seat.open && !seat.token)
        .map(([playerId]) => playerId),
      status: r.pendingStart || r.pendingPhantomStart ? "lobby" : "active",
    }));
}

export type { Move, Role };
