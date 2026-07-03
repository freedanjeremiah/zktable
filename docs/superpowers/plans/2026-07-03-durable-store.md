# M8.4 Durable Match Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matches survive restarts and are shareable by URL: a `MatchRecord` (serializable) / `MatchRuntime` (hydrated) split behind a small async `MatchStore` interface with memory + Redis backends, browser-session seat tokens, an open-match lobby, and page polling/resume.

**Architecture:** Everything in `MatchRuntime` is reconstructible except the Phantom secret (serialized as hex) and the event log (replayed through a fresh local `Match` to rebuild the mirror). Store selection: `REDIS_URL` ⇒ `RedisMatchStore` (ioredis, JSON blob per match + open-set, 24 h TTL), else the existing `globalThis` map now holding records. A per-process hydration cache keyed by `id:updatedAt` keeps hot reads cheap.

**Tech Stack:** ioredis (lazy import), Next.js cookies() for the session token.

**Spec:** `docs/superpowers/specs/2026-07-03-durable-store-design.md`

---

### Task 1: `match-record.ts` — serialize + hydrate (TDD)
- Create `packages/web/lib/blackout/match-record.ts`: `MatchRecord` type (version 1; plain-JSON mirror of `MatchRuntime` with `saltHex`, `agentSeats`, `playerIndexEntries`, `localSeed`, `seats`, `updatedAt`), `toRecord(runtime)`, `hydrateRecord(record)` (rebuild client/graph/agents; rebuild `local` via `createLocalMatch(roster, config, localSeed)` + `setSecret(phantom)` + replaying `log` moves, skipping `reveal`/`error` events).
- Test `match-record.test.ts`: build a runtime via the real game def (no chain), play scripted moves incl. a hidden move, round-trip → identical `local.state`, phantom secret, maps, DTO-relevant fields.

### Task 2: `store.ts` — MatchStore interface + backends
- `MemoryMatchStore` (globalThis map of records) and `RedisMatchStore` (keys `zktable:match:{id}` with `EX 86400`, set `zktable:open-matches`; lazy `import('ioredis')`), `resolveStore()` singleton by env.
- Rework `match-store.ts`: `saveMatch`/`getMatch` become async (serialize on save; hydration cache keyed `id:updatedAt`), add `listOpenMatches()`, keep `MatchRuntime` type + new fields `localSeed`, `agentSeats`, `seats`.
- Test with an injected fake redis (get/set/del/sadd/srem/smembers).

### Task 3: sessions + lobby routes + orchestrator async
- `session.ts`: `getOrSetSessionToken()` via `cookies()`.
- Orchestrator: `createBlackoutMatch` gains `{open, creatorToken}`; human seat token-bound unless `open`; `requireMatch` async; move paths reject a caller whose token doesn't match the seat's (403) when the seat is token-bound.
- Routes: `GET /api/blackout/matches` (list open), `POST /api/blackout/matches/[id]/join` (claim seat with token); existing routes await the async store and re-save after mutations.

### Task 4: page resume + polling
- `/play/blackout` reads `?match=` to resume (fetch DTO, set active); after create, `history.replaceState` writes the id into the URL; 4 s polling while active and it's not the local player's turn.

### Task 5: tests green + docs
- `pnpm --filter @zktable/web test`, tsc clean; limitations §3 rewritten; milestones M8.4 entry (manual restart-resume check).
