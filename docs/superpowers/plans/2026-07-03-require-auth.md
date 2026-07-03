# M8.1 Referee `require_auth()` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind every per-seat in-game entry point of all three referees to the seat owner's Stellar `Address` via `require_auth()`, with per-seat CLI signing in the TS clients and a Freighter prepare/sign/submit path for the web investigator.

**Architecture:** Each referee stores an `Address` per seat (Blackout already does; Liar's Dice and Coup gain a `Vec<Address>` constructor arg) and calls `require_auth()` on it at the top of every per-seat in-game entry point. `join`/`start` stay permissionless (see spec). Off-chain, `CliRefereeClient` picks a per-seat `--source`; the web app builds unsigned XDR server-side (`--build-only` → `stellar tx simulate`), signs in Freighter, submits with `stellar tx send`.

**Tech Stack:** soroban-sdk 26 (`Address::require_auth`, `mock_all_auths`/`mock_auths`), stellar CLI 27 (`tx simulate`, `tx send`), `@stellar/freighter-api`.

**Spec:** `docs/superpowers/specs/2026-07-03-require-auth-design.md`

---

### Task 1: Blackout referee — seat auth (Rust)

**Files:**
- Modify: `packages/contracts/contracts/referee/src/lib.rs`
- Test: `packages/contracts/contracts/referee/tests/referee.rs`

- [ ] **Step 1: Make existing tests auth-tolerant.** In `tests/referee.rs`, `setup_env()` add `env.mock_all_auths();` after the budget reset:

```rust
fn setup_env() -> Env {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    env.mock_all_auths();
    let _ = env.host().set_diagnostic_level(DiagnosticLevel::None);
    env
}
```

- [ ] **Step 2: Write the failing negative test** at the end of `tests/referee.rs`. It drives the contract through the generated client (auth is only enforced on real cross-contract invocation paths) and mocks auth for the WRONG address:

```rust
// ---------- auth: a signer who doesn't own the seat is rejected ----------

#[test]
fn wrong_signer_cannot_move_a_seat() {
    let env = Env::default();
    env.cost_estimate().budget().reset_unlimited();
    let _ = env.host().set_diagnostic_level(DiagnosticLevel::None);
    let verifier_id = register_verifier(&env);
    let root = fixture_root(&env);
    let referee_id = register_referee(&env, verifier_id, root, 24, reveal_rounds_24(&env));
    let client = zktable_referee::RefereeContractClient::new(&env, &referee_id);

    let phantom_addr = Address::generate(&env);
    let investigator_addr = Address::generate(&env);
    let attacker = Address::generate(&env);

    // Lobby setup is permissionless-but-authed-per-seat: mock all auths just
    // for the setup calls so the roster is valid.
    env.mock_all_auths();
    client.join(&phantom_addr, &phantom_role(&env), &1, &1, &1);
    client.join(&investigator_addr, &investigator_role(&env), &1, &1, &1);
    client.set_hidden_start(&0, &fixture_c_old(&env));
    client.set_public_start(&1, &10);
    client.start();

    // Phantom's turn (seat 0). The attacker signs instead of the phantom:
    // require_auth(phantom_addr) must fail the invocation.
    env.set_auths(&[]);
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &attacker,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &referee_id,
            fn_name: "submit_hidden_move",
            args: (0u32, fixture_c_new(&env), 0u32, Bytes::from_slice(&env, PROOF_BIN)).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    let res = client.try_submit_hidden_move(&0, &fixture_c_new(&env), &0, &Bytes::from_slice(&env, PROOF_BIN));
    assert!(res.is_err(), "attacker-signed hidden move must be rejected");
}
```

(Adjust imports: `use soroban_sdk::{testutils::{Address as _, MockAuth, MockAuthInvoke}, IntoVal};` — check what the file already imports.)

- [ ] **Step 3: Run to verify it fails** (auth not yet enforced, so the move *succeeds* and the `assert!(res.is_err())` fails):

```
cd packages/contracts && cargo +stable test -p zktable-referee --test referee wrong_signer_cannot_move_a_seat
```
Expected: FAIL on the assert.

- [ ] **Step 4: Implement seat auth in `src/lib.rs`.** Add a helper below `check_turn`:

```rust
/// Loads the seat and requires its owner's authorization. Every per-seat
/// in-game entry point calls this FIRST; `join`/`start` stay permissionless
/// (enrolling an address costs it nothing — the trust boundary is actions).
fn require_seat_auth(players: &Vec<PlayerData>, player: u32) -> Result<PlayerData, Error> {
    let p = players.get(player).ok_or(Error::BadPlayerIndex)?;
    p.address.require_auth();
    Ok(p)
}
```

Wire it into the five per-seat entry points, replacing their existing `players.get(player).ok_or(Error::BadPlayerIndex)?` line:
- `set_hidden_start`: `let mut p = require_seat_auth(&players, player)?;`
- `set_public_start`: same
- `submit_hidden_move`: same (place BEFORE `check_turn` result usage is fine, but keep `check_turn` first so `NotYourTurn` still wins when both fail — actually keep existing order: status check, `check_turn`, then `require_seat_auth` replacing the get)
- `submit_public_move`: same
- `reveal`: `let p = require_seat_auth(&players, player)?;` (it binds `p` immutably today)

- [ ] **Step 5: Run the new test + full referee suite:**

```
cargo +stable test -p zktable-referee
```
Expected: all pass (old tests via `mock_all_auths`, new test passes because attacker auth ≠ phantom).

- [ ] **Step 6: Commit** — `git commit -m "Blackout referee: bind per-seat moves to the seat address via require_auth"`

### Task 2: Liar's Dice referee — addresses + auth (Rust)

**Files:**
- Modify: `packages/contracts/contracts/liars-dice-referee/src/lib.rs`
- Test: `packages/contracts/contracts/liars-dice-referee/tests/referee.rs`

- [ ] **Step 1:** Add `env.mock_all_auths();` to the test setup fn (same as Task 1 Step 1).

- [ ] **Step 2:** Constructor takes owners. In `src/lib.rs`:
  - `PlayerData` gains `pub address: Address,` (first field).
  - `__constructor(env, verifier: Address, players: Vec<Address>, dice_per_player: u32, sides: u32)` — validate `players.len() != N_PLAYERS → Error::UnsupportedConfig` (keeps the v1 2-player lock), store `n_players = players.len()`, and build each `PlayerData { address: players.get(i).unwrap(), nonce_commitment: None, ... }`.
  - Add the same `require_seat_auth` helper as Task 1 (identical body; `PlayerData` here also has `.address` now).
  - Call it first in: `commit_nonce`, `reveal_nonce`, `submit_dice`, `bid`, `challenge`, `reveal_dice` — replacing each `players.get(player).ok_or(Error::BadPlayerIndex)?`. NOTE: in functions that only read `player` later (e.g. `challenge`), still call the helper for the auth side effect.

- [ ] **Step 3:** Update test registration: `register_referee` builds a `Vec<Address>` of two `Address::generate(env)` and passes `(verifier, players_vec, 5u32, 6u32)`. Keep the addresses reachable from tests (return them or store in a struct) for the negative test.

- [ ] **Step 4:** Add negative test (client + `mock_auths` for an attacker on `bid`, mirroring Task 1 Step 2 exactly — same MockAuth pattern, fn_name `"bid"`, args `(player, quantity, face)`). Run:

```
cargo +stable test -p zktable-liars-dice-referee
```
Expected: all pass including the new rejection test.

- [ ] **Step 5: Commit** — `git commit -m "Liar's Dice referee: per-seat addresses + require_auth on every move"`

### Task 3: Coup referee — addresses + auth (Rust)

**Files:**
- Modify: `packages/contracts/contracts/coup-referee/src/lib.rs`
- Test: `packages/contracts/contracts/coup-referee/tests/referee.rs`

- [ ] **Step 1:** `env.mock_all_auths();` in test setup.
- [ ] **Step 2:** `PlayerData` gains `pub address: Address,`; `__constructor(env, verifier, players: Vec<Address>)` with `players.len()` validated against `MIN_PLAYERS..=MAX_PLAYERS`; same `require_seat_auth` helper.
  Authorizer per entry point (the acting seat, not the subject):
  - `deal(player, …)` → `player` (the seat acknowledges its own hand commitments)
  - `claim(player, …)` → `player`
  - `challenge(challenger, target)` → `challenger`
  - `prove_hold(target, …)` → `target`
  - `reveal_card(player, …)` → `player`
- [ ] **Step 3:** Update test registration to pass a `Vec<Address>`; add the attacker negative test on `claim` (same MockAuth pattern). Run `cargo +stable test -p zktable-coup-referee` — all pass.
- [ ] **Step 4:** Full workspace check: `cargo +stable test --workspace` green, then rebuild wasms:

```
cargo +stable build --release --target wasm32v1-none -p zktable-referee -p zktable-liars-dice-referee -p zktable-coup-referee
```
- [ ] **Step 5: Commit** — `git commit -m "Coup referee: per-seat addresses + require_auth on every move"`

### Task 4: Per-seat signing in the three TS clients

**Files:**
- Modify: `games/blackout/src/referee-client.ts`, `games/liars-dice/src/referee-client.ts`, `games/coup-lite/src/referee-client.ts`
- Test: `games/blackout/src/referee-client.test.ts` (+ the liars/coup twins)

- [ ] **Step 1: Failing test** (blackout twin as the template — the other two follow the same existing test style with mocked `execFile`):

```ts
it('signs a seat move with that seat\'s source when sourceForSeat is set', async () => {
  const calls = execFileMock.mock.calls  // existing mock plumbing in this file
  const client = new CliRefereeClient({ sourceForSeat: { 0: 'phantom-key', 1: 'inv-key' } })
  await client.submitPublicMove('CID', { player: 1, node: 5, ticket: 0 })
  const args = calls.at(-1)![1] as string[]
  expect(args).toContain('--source')
  expect(args[args.indexOf('--source') + 1]).toBe('inv-key')
})
```

- [ ] **Step 2:** Run `pnpm --filter @zktable/blackout test` — FAIL (option doesn't exist).
- [ ] **Step 3:** Implement in all three clients:
  - `CliRefereeClientOptions` gains `sourceForSeat?: Record<number, string>`.
  - `invoke(contractId, methodArgs, seat?: number)`; the `--source` value becomes `seat !== undefined ? (this.sourceForSeat?.[seat] ?? this.source) : this.source`.
  - Every mutating per-seat method passes its seat: blackout `setHiddenStart`/`setPublicStart`/`submitHiddenMove`/`submitPublicMove`/`reveal`; liars `commitNonce`/`revealNonce`/`submitDice`/`bid`/`challenge`/`revealDice`; coup `deal`/`claim`/`challenge` (seat = challenger)/`proveHold` (seat = target)/`revealCard`. `join`/`start`/deploys keep the default source.
  - Liars/coup `deployReferee` signature: replace `nPlayers` with `playerAddresses: string[]` → CLI arg `--players '["G...","G..."]'` (JSON vec of addresses, same convention as blackout's `--reveal-rounds`).
- [ ] **Step 4:** `pnpm --filter @zktable/blackout --filter @zktable/liars-dice --filter @zktable/coup-lite test` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Referee clients: per-seat --source signing + address-vector deploys"`

### Task 5: Runners — multi-identity testnet mode

**Files:**
- Create: `games/blackout/src/identities.ts` (shared helper; liars/coup import their own copy — packages don't cross-import games)
- Modify: `games/blackout/src/runner.ts`, `games/liars-dice/src/runner.ts`, `games/coup-lite/src/runner.ts` (+ their `play.ts` env plumbing)

- [ ] **Step 1:** `identities.ts` (per game package, same 30 lines — they already duplicate `addressOf`):

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_STELLAR_BIN, toolEnv } from './paths.js'

const execFileAsync = promisify(execFile)

/** Ensures a funded testnet identity exists for each name; returns name -> G-address. */
export async function ensureIdentities(names: string[], stellarBin = DEFAULT_STELLAR_BIN): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of names) {
    try {
      await execFileAsync(stellarBin, ['keys', 'address', name], { env: toolEnv() })
    } catch {
      await execFileAsync(stellarBin, ['keys', 'generate', name, '--network', 'testnet', '--fund'], { env: toolEnv() })
    }
    const { stdout } = await execFileAsync(stellarBin, ['keys', 'address', name], { env: toolEnv() })
    out[name] = stdout.trim()
  }
  return out
}
```

- [ ] **Step 2:** Wire into each runner: when `<GAME>_MULTISIG=1`, seat identities are `[source, `${source}-seat1`, …]` via `ensureIdentities`, the referee deploy passes those addresses (liars/coup) / `join` uses them (blackout), and the client gets `sourceForSeat`. Default path (no env var): every seat = `source` — byte-identical behavior to today.
- [ ] **Step 3:** Unit-test the seat→identity mapping function (pure part extracted as `seatIdentityNames(source, n)`), plus existing runner tests stay green: `pnpm test`.
- [ ] **Step 4: Commit** — `git commit -m "Runners: optional multi-identity signing (MULTISIG=1) for per-seat auth"`

### Task 6: Web — Freighter-signed investigator moves

**Files:**
- Modify: `packages/web/lib/wallet/freighter-adapter.ts` (add `signTransaction` wrapper)
- Modify: `packages/web/lib/blackout/orchestrator.ts` (add `prepareHumanMove`, `submitSignedMove`; `createBlackoutMatch` gains `walletAddress?`)
- Create: `packages/web/app/api/blackout/matches/[id]/moves/prepare/route.ts`, `.../moves/submit/route.ts`
- Modify: `packages/web/app/play/blackout/page.tsx` (sign path when wallet connected)
- Test: `packages/web/lib/blackout/prepare.test.ts`

- [ ] **Step 1:** Orchestrator: creation accepts `walletAddress?: string`; when set, the human investigator seat `join`s with it (server signs the join — permissionless by design) and its `set_public_start` is issued through the prepare/sign path below before `start()` — concretely, creation returns a `pendingStart: {player, node, xdr}` DTO field the client must sign & submit, and `start()` is deferred into the submit handler for that signature. When absent: exactly today's flow.
- [ ] **Step 2:** `prepareHumanMove(runtime, {player, node, ticket})` shells:
  1. `stellar contract invoke --id <referee> --source-account <G-addr> --network testnet --build-only -- submit_public_move --player N --node N --ticket N` → unsigned XDR
  2. `stellar tx simulate --network testnet` (stdin = XDR) → assembled XDR
  Returns `{xdr}`. `submitSignedMove(runtime, signedXdr)`: `stellar tx send --network testnet` (stdin), then the existing post-move flow (`advanceAiTurns`, DTO).
  **Verification checkpoint:** if `--source-account <G-address>` is rejected for build-only by stellar CLI 27, fall back to `--source` with a throwaway local identity whose pubkey is overridden via `--source-account`; confirm against the real CLI before wiring routes (spike this first with a deployed referee id — 10 minutes).
- [ ] **Step 3:** Routes are thin wrappers (same error translation as `moves/route.ts`); `page.tsx`: when `useWallet().status === 'connected'` and the seat address matches, move clicks go prepare → `freighterSignTransaction(xdr, {networkPassphrase: TESTNET_PASSPHRASE})` → submit; otherwise legacy route.
- [ ] **Step 4:** `prepare.test.ts`: mock `execFile`; assert prepare passes `--build-only` + the wallet address and submit pipes the signed XDR to `tx send`. `pnpm --filter @zktable/web test` green.
- [ ] **Step 5: Commit** — `git commit -m "Web: Freighter-signed investigator moves via prepare/sign/submit"`

### Task 7: Testnet acceptance + docs

**Files:**
- Modify: `docs/milestones.md` (M8.1 evidence), `docs/limitations.md` §2 (rewrite), `HANDOFF.md` (next-steps ledger)

- [ ] **Step 1:** Ensure `alice` exists/funded; run `BLACKOUT_TESTNET=1 BLACKOUT_MULTISIG=1 pnpm --filter @zktable/blackout play` — full game, distinct signers per seat.
- [ ] **Step 2:** Wrong-signer on-chain rejection: with the match's referee id, invoke `submit_public_move` for the investigator seat using `--source alice-seat1`'s key while the seat belongs to a different identity — expect the auth failure error from the CLI. Capture tx hash/error line.
- [ ] **Step 3:** `LIARS_TESTNET=1 LIARS_MULTISIG=1 …` and `COUP_TESTNET=1 COUP_MULTISIG=1 …` full runs.
- [ ] **Step 4:** Update docs (limitations §2 now describes what IS enforced + the lobby-phase caveat), record contract ids + tx hashes in `docs/milestones.md` under **M8.1**.
- [ ] **Step 5: Commit** — `git commit -m "M8.1: per-seat auth verified on testnet (docs + evidence)"`
