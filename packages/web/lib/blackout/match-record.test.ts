// M8.4: the serialize -> hydrate round-trip must reproduce the live
// runtime — most critically the local Match mirror (rebuilt by replaying
// the event log) and the Phantom's secret. Uses the real game definition
// and city map; no chain, no binaries.

import { describe, expect, it } from "vitest";
import { HeuristicAgent } from "@zktable/agents";
import { BoardGraph } from "@zktable/circuits";
import {
  CliRefereeClient,
  DEFAULT_N_ROUNDS,
  DEFAULT_REVEAL_ROUNDS,
  DEFAULT_TICKETS,
  blackoutInvestigatorPolicy,
  blackoutPhantomPolicy,
  buildRoster,
  cityGraphData,
  createLocalMatch,
  rosterTickets,
} from "@zktable/blackout";
import type { BlackoutConfig } from "@zktable/blackout";
import { hydrateRecord, toRecord } from "./match-record";
import type { MatchRuntime } from "./match-store";
import {
  MemoryMatchStore,
  RedisMatchStore,
  getMatch,
  saveMatch,
  setStoreForTesting,
} from "./match-store";
import type { RedisLike } from "./match-store";

function buildTestAgent(_model: string | undefined, role: "phantom" | "investigator") {
  return new HeuristicAgent(role === "phantom" ? blackoutPhantomPolicy : blackoutInvestigatorPolicy);
}

/** A live runtime with two moves already played (one hidden, one public). */
function buildRuntime(): MatchRuntime {
  const roster = buildRoster(2); // phantom + 2 investigators
  const startPositions = { phantom: 1, investigator1: 40, investigator2: 50 };
  const config: BlackoutConfig = {
    startPositions,
    tickets: rosterTickets(roster, DEFAULT_TICKETS),
    nRounds: DEFAULT_N_ROUNDS,
    revealRounds: DEFAULT_REVEAL_ROUNDS,
  };
  const localSeed = "record-roundtrip-seed";
  const local = createLocalMatch(roster, config, localSeed);

  const runtime: MatchRuntime = {
    id: "test-match-1",
    refereeId: "CREFEREE",
    verifierId: "CVERIFIER",
    client: new CliRefereeClient({ network: "testnet", source: "alice" }),
    graph: new BoardGraph(cityGraphData),
    local,
    roster,
    playerIndex: new Map([
      ["phantom", 0],
      ["investigator1", 1],
      ["investigator2", 2],
    ]),
    indexToPlayer: new Map([
      [0, "phantom"],
      [1, "investigator1"],
      [2, "investigator2"],
    ]),
    phantom: { pos: 3, salt: 123456789n },
    agents: new Map([["phantom", buildTestAgent(undefined, "phantom")]]),
    config,
    explorerUrl: "https://example.test/CREFEREE",
    network: "testnet",
    source: "alice",
    createdAt: 1_700_000_000_000,
    localSeed,
    log: [],
    seats: { investigator1: { open: false, token: "tok-1" }, investigator2: { open: true } },
    open: true,
    phantomHuman: false,
    pendingPhantomStart: false,
  };

  // Play the Phantom's opening hidden move + investigator1's public move,
  // recording them the way the orchestrator does.
  const phantomMove = runtime.local.view("phantom").legalMoves[0]!;
  runtime.local.submit("phantom", phantomMove);
  runtime.local.setSecret("phantom", { pos: phantomMove.to });
  runtime.log.push({
    type: "hidden_move",
    round: 0,
    player: "phantom",
    to: phantomMove.to as number,
    ticket: phantomMove.ticket as number,
    txOk: true,
    at: 1,
  });
  const invMove = runtime.local.view("investigator1").legalMoves[0]!;
  runtime.local.submit("investigator1", invMove);
  runtime.log.push({
    type: "public_move",
    round: 0,
    player: "investigator1",
    to: invMove.to as number,
    ticket: invMove.ticket as number,
    txOk: true,
    at: 2,
  });
  return runtime;
}

describe("toRecord / hydrateRecord", () => {
  it("round-trips a live runtime: local mirror, phantom secret, maps, seats", () => {
    const runtime = buildRuntime();
    const hydrated = hydrateRecord(JSON.parse(JSON.stringify(toRecord(runtime))), buildTestAgent);

    expect(hydrated.local.state).toEqual(runtime.local.state);
    expect(hydrated.local.view("phantom").self.secret).toEqual(runtime.local.view("phantom").self.secret);
    expect(hydrated.phantom).toEqual(runtime.phantom);
    expect([...hydrated.playerIndex.entries()]).toEqual([...runtime.playerIndex.entries()]);
    expect([...hydrated.indexToPlayer.entries()]).toEqual([...runtime.indexToPlayer.entries()]);
    expect(hydrated.agents.has("phantom")).toBe(true);
    expect(hydrated.seats).toEqual(runtime.seats);
    expect(hydrated.open).toBe(true);
    expect(hydrated.localSeed).toBe(runtime.localSeed);
    expect(hydrated.log).toEqual(runtime.log);
  });

  it("refuses a record from a newer schema version", () => {
    const record = toRecord(buildRuntime());
    expect(() => hydrateRecord({ ...record, version: 99 }, buildTestAgent)).toThrow(/version 99/);
  });
});

describe("MemoryMatchStore via saveMatch/getMatch", () => {
  it("persists across save/load and reuses the hydration cache for unchanged records", async () => {
    setStoreForTesting(new MemoryMatchStore());
    try {
      const runtime = buildRuntime();
      await saveMatch(runtime);
      const first = await getMatch("test-match-1", buildTestAgent);
      expect(first).toBe(runtime); // saveMatch caches the live instance
      expect((await getMatch("missing", buildTestAgent))).toBeUndefined();
    } finally {
      setStoreForTesting(undefined);
    }
  });
});

describe("RedisMatchStore", () => {
  function fakeRedis(): RedisLike & {
    data: Map<string, string>;
    sets: Map<string, Set<string>>;
    ttls: Map<string, number>;
  } {
    const data = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    const ttls = new Map<string, number>();
    return {
      data,
      sets,
      ttls,
      async set(key, value, _ex, seconds) {
        data.set(key, value);
        ttls.set(key, seconds);
      },
      async get(key) {
        return data.get(key) ?? null;
      },
      // Mirrors CAS_SAVE_LUA: reject unless stored revision === expected.
      async eval(_script, _numKeys, key, value, expected, ttl) {
        const cur = data.get(String(key));
        const rev = cur ? ((JSON.parse(cur).revision as number | undefined) ?? 0) : 0;
        if (cur ? rev !== Number(expected) : Number(expected) !== 0) return 0;
        data.set(String(key), String(value));
        ttls.set(String(key), Number(ttl));
        return 1;
      },
      async del(key) {
        data.delete(key);
      },
      async sadd(key, member) {
        if (!sets.has(key)) sets.set(key, new Set());
        sets.get(key)!.add(member);
      },
      async srem(key, member) {
        sets.get(key)?.delete(member);
      },
      async smembers(key) {
        return [...(sets.get(key) ?? [])];
      },
    };
  }

  it("saves with CAS + TTL, loads, indexes open matches, and tidies stale index entries", async () => {
    const redis = fakeRedis();
    const store = new RedisMatchStore(redis);
    const record = { ...toRecord(buildRuntime()), revision: 1 };

    await store.save(record);
    expect(await store.load(record.id)).toEqual(JSON.parse(JSON.stringify(record)));
    expect((await store.listOpen()).map((r) => r.id)).toEqual([record.id]);
    // Every save refreshes the TTL (records evaporate a week after the last write).
    expect(redis.ttls.get(`zktable:match:${record.id}`)).toBe(7 * 24 * 60 * 60);

    // A stale-revision save is rejected (lost-update guard)…
    await expect(store.save({ ...record, open: false })).rejects.toThrow(/updated concurrently/);
    // …while the successor revision lands and closes the match.
    await store.save({ ...record, open: false, revision: 2 });
    expect(await store.listOpen()).toEqual([]);

    // A dangling index entry (expired record) is tidied on read.
    await redis.sadd("zktable:open-matches", "ghost");
    expect(await store.listOpen()).toEqual([]);
    expect(redis.sets.get("zktable:open-matches")!.has("ghost")).toBe(false);

    await store.delete(record.id);
    expect(await store.load(record.id)).toBeNull();
  });
});
