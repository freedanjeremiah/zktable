# Design: Referee `require_auth()` + per-seat addresses

**Status:** approved for implementation (M8.1)
**Handoff item:** #1 — "Referee `require_auth()` + Freighter-signed investigator moves → fully trustless multiplayer."

## Problem

No referee calls `require_auth()` anywhere (verified: zero occurrences in
`packages/contracts`). Every move-dispatch entry point trusts a caller-supplied
`player: u32` seat index, so any signer can move any seat
(`docs/limitations.md` §2). Only the Blackout referee stores a per-seat
`Address` at all (`join`, `referee/src/lib.rs:267`), and only as display
metadata. The Liar's Dice and Coup referees pre-allocate seats in their
constructors with no `Address` whatsoever. Off-chain, one CLI identity
(`alice`) signs every transaction for every seat.

## Goal

Bind every per-seat mutating entry point to the seat owner's Stellar
`Address` via `require_auth()`, across all three referees, with the TS
clients able to sign per-seat, and the web app able to submit a
Freighter-signed investigator move. Negative tests prove a wrong signer is
rejected.

## Non-goals

- Anti-replay for proofs (limitations §7) — unchanged, out of scope.
- Multi-wallet AI seats: the backend's AI seats may all be owned by one
  server identity. That is legitimate (the server owns those seats).
- Fees/escrow/stakes — nothing economic.

## Design

### Contract changes (all three referees)

**Seat → Address binding.**
- `referee` (Blackout): `PlayerData.address` already exists. `join(addr, …)`
  now calls `addr.require_auth()` so nobody can enroll an address they don't
  control. Every per-seat mutating entry point (`set_hidden_start`,
  `set_public_start`, `submit_hidden_move`, `submit_public_move`, `reveal`)
  loads the seat's stored address and calls `require_auth()` on it before any
  other check. `start()` stays permissionless (it only flips state when the
  roster is complete — anyone may trigger it; add a doc comment saying so).
- `liars-dice-referee` and `coup-referee`: constructor gains
  `players: Vec<Address>` (replacing bare `n_players: u32`; `n_players` is
  derived as `players.len()` and validated exactly as today). `PlayerData`
  gains `address: Address`. Every per-seat entry point (`commit_nonce`,
  `reveal_nonce`, `submit_dice`, `bid`, `challenge`, `reveal_dice`; `deal`,
  `claim`, `challenge`, `prove_hold`, `reveal_card`) starts with
  `players.get(seat).address.require_auth()`. For coup's `challenge(challenger,
  target)` the **challenger** authorizes; for `prove_hold(target, …)` the
  **target** authorizes; `reveal_card`'s authorizer is the `player` arg (the
  role-in-exchange checks that follow are unchanged).
- New shared error variant `Error::NotSeatOwner` is unnecessary —
  `require_auth()` failure aborts the invocation host-side. Keep existing
  error codes untouched so ABI churn is minimal.

**Storage:** no new keys; the address rides inside the existing `players`
vector entries. This changes the stored `PlayerData` layout for liars/coup —
acceptable because contracts are deployed fresh per match (no migration).

### Rust tests

Tests currently call impl fns inside `env.as_contract(...)`, which bypasses
auth. They move to the generated `Client` (`RefereeContractClient` etc.) with
`env.mock_auths(...)`:
- Positive path: each seat's calls mocked as that seat's address — full happy
  paths stay green.
- Negative path (new, per referee): invoking a seat's move with only a
  *different* address's auth mocked must panic/err (assert via
  `try_` client variants or `#[should_panic]`).
- `mock_all_auths()` is allowed only in tests whose subject is not auth.

### TS client changes

`CliRefereeClient` (all three games) gains per-seat signing:
- `opts.sourceForSeat?: Record<number, string>` — CLI identity name per seat
  index; `invoke()` picks `sourceForSeat[seat] ?? this.source`. The seat is
  extracted explicitly: mutating methods pass `{ seat }` to `invoke()`.
- Deploy/constructor paths pass the seat addresses:
  liars/coup `deployReferee` gains `playerAddresses: string[]`.
- New helper in each game package: `ensureIdentities(names: string[])` —
  `stellar keys generate` + `stellar keys fund … --network testnet` (skip if
  exists), reusing the existing `addressOf()` pattern
  (`games/blackout/src/runner.ts:363`).
- Runners: default remains single-identity `alice` for all seats (works —
  alice legitimately owns every seat, auth passes). A new env toggle
  (`*_MULTISIG=1`) provisions one identity per seat to demonstrate genuine
  multi-wallet play on testnet.

### Web: Freighter-signed investigator move

The human investigator's seat is joined with the **connected wallet's
address** (falling back to the server identity when no wallet is connected,
preserving today's demo flow). Submitting a move becomes two-step:

1. `POST /api/blackout/matches/[id]/moves/prepare` — server builds the
   invocation with `stellar contract invoke --build-only` (source = the
   wallet's G-address, which must be funded; Friendbot affordance already
   exists in the wallet button) and returns the unsigned transaction XDR.
2. Browser signs it with Freighter (`signTransaction`), then
   `POST …/moves/submit` with the signed XDR; the server submits it via
   `stellar tx send` and then runs the existing post-move flow
   (`advanceAiTurns`, DTO refresh).

Since the transaction source account *is* the seat address,
`require_auth()` is satisfied by source-account credentials — no separate
auth-entry signing is needed. If no wallet is connected the existing
single-step `POST …/moves` path continues to work with the server identity.

### Error handling

- `--build-only`/`tx send` failures surface as `BlackoutApiError(502)` with
  the CLI stderr line, same convention as today's invoke errors.
- A signed-XDR submit for a match/seat the token doesn't own → 403 (seat
  binding is by address; the contract enforces the real check).

## Testing

- Rust: per-referee positive auth paths + negative wrong-signer tests
  (the load-bearing new coverage).
- TS: `referee-client` unit tests for `sourceForSeat` selection (mock
  `execFile` argv assertions, same style as existing client tests).
- Testnet acceptance: one Blackout run with `BLACKOUT_MULTISIG=1` (distinct
  phantom/investigator identities), plus one wrong-signer rejection recorded
  in `docs/milestones.md` (M8.1 evidence).
- Web: prepare/sign/submit exercised manually with Freighter; the prepare
  route gets a unit test for XDR passthrough shape.
