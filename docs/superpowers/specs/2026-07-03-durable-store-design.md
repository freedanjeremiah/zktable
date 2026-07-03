# Design: Durable match store + minimal matchmaking

**Status:** approved for implementation (M8.4)
**Handoff item:** #4 — "Durable match store (Redis/DB) + matchmaking for the
web app."

## Problem

`packages/web/lib/blackout/match-store.ts` is a `Map` on `globalThis`: a dev
restart loses every match, a second instance can't see them, entries are
never evicted, and the `matchId` lives only in client React state — a page
reload orphans the match. Separately, seat access is unauthenticated: anyone
with a `matchId` can POST any human seat's move (`orchestrator.ts:227-242`
checks turn, not identity). The store's own header comment promises the swap
can happen "without touching the orchestrator's public API".

## Goal

Matches survive server restarts and are shareable/joinable by URL. The store
is a small interface with two backends (in-memory default, Redis when
`REDIS_URL` is set). Human seats are bound to a browser session token.
Matchmaking is a minimal open-match lobby: create-as-open, list, join.

## Non-goals

- Horizontal scaling of the *orchestrator* (proving still shells out to
  local binaries; one match is still driven by one process at a time).
- Accounts/profiles, ELO, private lobbies, spectator auth.
- Durable storage for Liar's Dice / Coup-lite web play (they have no web
  backend yet).

## Design

### Record/runtime split

`MatchRuntime` splits into a serializable `MatchRecord` plus a hydration
step. Everything in the runtime is reconstructible except the Phantom
secret, which serializes explicitly:

| Runtime field | Record form |
|---|---|
| `client: CliRefereeClient` | `{network, source}` strings (client holds no handles) |
| `graph: BoardGraph` | rebuilt from `cityGraphData` (constant) |
| `local: Match` | rebuilt via `createLocalMatch(config)` + `setSecret` + replaying `log` (the event log already records every move) |
| `phantom: {pos, salt: bigint}` | `{pos, saltHex}` (`toBe32Hex`) |
| `agents: Map<PlayerId, Agent>` | `agentSeats: Record<PlayerId, {kind: 'claude'\|'heuristic', role}>`; rebuilt via `buildAgent` (agents are stateless across turns — `observe()` is a no-op) |
| Maps (`playerIndex` etc.) | plain objects |
| everything else | already JSON-safe |

New fields on the record: `version` (schema version, start at 1), `seats:
Record<PlayerId, {token?: string, open: boolean}>` (seat ownership),
`updatedAt`.

### Store interface

```ts
interface MatchStore {
  save(record: MatchRecord): Promise<void>
  load(id: string): Promise<MatchRecord | null>
  listOpen(): Promise<MatchSummary[]>   // id, createdAt, openSeats, status
  delete(id: string): Promise<void>
}
```

- `MemoryMatchStore`: today's `globalThis` Map, now storing records.
- `RedisMatchStore` (ioredis): `zktable:match:{id}` JSON string with a 24 h
  TTL refreshed on save (solves unbounded growth), plus a
  `zktable:open-matches` set for the lobby. Selected at startup:
  `process.env.REDIS_URL ? redis : memory`.
- A per-process hydration cache keyed by `id` + `updatedAt` keeps the hot
  path cheap (hydrating replays the log only when the record changed
  underneath us). Single-writer-per-match is assumed and documented — the
  orchestrator's request flow already serializes writes per match in
  practice; a `version` check on save turns silent clobbers into 409s.

### Sessions and seat binding

- On create/join, the server issues a random token in an httpOnly cookie
  (`zktable_session`, per-browser, generated once) and writes it into the
  claimed seat's `seats[playerId].token`.
- The moves route (and the prepare/submit routes from the require_auth
  spec) resolves the caller's seat from the cookie and rejects a mismatch
  with 403. AI seats have no token. This closes the "anyone with matchId
  can move" hole at the API layer (the contract-level fix is M8.1's job).

### Routes and pages

- `GET /api/blackout/matches` — list open matches (new; `listMatchIds` dies).
- `POST /api/blackout/matches` — gains `{open?: boolean}`; when open, the
  human investigator seat starts unclaimed.
- `POST /api/blackout/matches/[id]/join` — claim the open seat (binds token).
- `/play/blackout?match=<id>` — the page reads the query param, fetches the
  match, and resumes; creating/joining now writes the id into the URL
  (shareable, reload-safe).
- Polling: the board page polls `GET /matches/[id]` every 4 s while the
  match is active and it's not the local player's turn (covers the second
  browser seeing AI/opponent moves; SSE is a follow-up, not now).

## Error handling

- Store unavailable (Redis down): routes return 503 with a plain message;
  memory fallback is **not** silently used (would fork state).
- Hydration failure (schema drift): 500 + log; `version` gates future
  migrations.
- Save conflict (`version` mismatch): 409, client refetches.

## Testing

- Record round-trip: serialize → hydrate → identical DTO and identical
  local-mirror `state` (uses a scripted match with hidden moves + reveal).
- `RedisMatchStore` against `ioredis-mock`; `MemoryMatchStore` direct.
- Seat binding: join claims seat; move with wrong/missing cookie → 403;
  correct cookie → accepted (route-level tests with mocked orchestrator).
- Manual: create match, restart dev server, resume from URL, finish match.
