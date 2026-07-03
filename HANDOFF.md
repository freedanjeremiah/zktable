# zkTable — Engineering Handoff

**Status:** Milestones M0–M8 are implemented and verified on **live Stellar
testnet** (M8 = the first three post-M7 hardening workstreams: per-seat
`require_auth`, engine turn-skip elimination + N-player games, and the
`valid_shuffle` provably-fair deal). Nothing is mocked — every game runs a
full match on-chain with real UltraHonk proofs. Full test suite green:
**249 TypeScript tests + 92 Rust tests**, plus every circuit's `nargo test`.

Branches: `zktable-build` (M0–M7), `zktable-m8` (M8). Specs for all five
post-M7 workstreams: `docs/superpowers/specs/2026-07-03-*.md`.

---

## What's built (by milestone)

| Milestone | What | Evidence |
|---|---|---|
| **M0** | Monorepo + ZK pipeline proven on testnet | real proof verified in a live Soroban contract; tampered proof rejected (`Error #4`) |
| **M1** | `@zktable/core` — `defineGame`, deterministic engine, `PlayerView` (own-secret-only) | 71 tests |
| **M2** | `board` module: `move_along` circuit + `zktable-graph` tool + generic **referee** | hidden move ZK-verified through referee on testnet; proof bound to on-chain state |
| **M3** | Flagship **Blackout** (Scotland-Yard-style hidden pursuit) | full game → `Finished` on testnet, outcome `investigator`, Phantom moves ZK-verified, on-chain reveal |
| **M4** | `@zktable/web` — noir-arcade shell + backend match API + interactive board | AI-Phantom proofs verified on-chain via the API; board demoed end-to-end in a real browser (shadow inference, proof-status, reveal spotlight) |
| **M5** | `@zktable/agents` — `Agent` + `ClaudeAgent` (`claude-haiku-4-5`) + Blackout policies | 20 tests; anti-cheat proven by test (an agent's `PlayerView` cannot carry another player's secret) |
| **M6** | `dice` + **Liar's Dice**, `deck` + **Coup-lite** | both full games to real outcomes on testnet; `dice_valid` (seed-fair in-circuit) + `card_membership` (prove-hold-or-bluff) circuits |
| **M7** | Docs, ADRs, tutorial, demo script, honest limitations | see `docs/` |

Detailed on-chain evidence (contract IDs, tx hashes, outcomes) is in
[`docs/milestones.md`](./docs/milestones.md).

---

## Repository map

```
packages/
  core/        @zktable/core       — SDK: defineGame, engine, PlayerView
  circuits/    @zktable/circuits   — Noir circuits (move_along, dice_valid,
                                     card_membership) + TS witness/proof builders;
                                     scripts/build_*.sh; the `zktable-graph` tool lives
                                     under packages/contracts/tools/graph-tools
  contracts/   @zktable/contracts  — Soroban (Rust): vendored UltraHonk verifier +
                                     3 referees (board/blackout, liars-dice, coup);
                                     tools/graph-tools = off-chain Poseidon builder
  agents/      @zktable/agents     — Agent interface, HeuristicAgent, ClaudeAgent
  web/         @zktable/web        — Next.js arcade (landing, lobby, Blackout board, API)
games/
  blackout/    @zktable/blackout   — flagship game def + strategy + testnet runner
  liars-dice/  @zktable/liars-dice
  coup-lite/   @zktable/coup-lite
docs/          milestones, ADRs, tutorial, demo script, limitations
```

---

## Toolchain (pinned — versions are tightly coupled, do not bump casually)

- Node ≥ 20, pnpm 10; Rust **stable** with target **`wasm32v1-none`**
  (soroban-sdk 26 rejects `wasm32-unknown-unknown`).
- Noir `nargo` **1.0.0-beta.9**, Barretenberg `bb` **v0.87.0**
  (`~/.nargo/bin`, `~/.bb/bin`).
- Stellar CLI **23+**, `soroban-sdk` 26.0.1. Testnet is on Protocol 27.
- A funded testnet identity named `alice` (`stellar keys generate alice &&
  stellar keys fund alice --network testnet`).

**Build gotcha:** always build contracts with
`cargo +stable build --release --target wasm32v1-none -p <pkg>` — the
`stellar contract build` wrapper can pick the wrong toolchain.

**Proving gotcha:** every circuit is proven with
`bb prove --scheme ultra_honk --oracle_hash keccak ...` — the `keccak` oracle
hash is REQUIRED for the on-chain verifier.

---

## How to run

```bash
pnpm install
pnpm test                                   # all TS suites
packages/circuits/scripts/build_all.sh      # build circuit artifacts (needed by Rust tests)
cd packages/contracts && cargo +stable test --workspace   # all Rust suites

# Web arcade (human vs AI Phantom):
pnpm --filter @zktable/web dev              # note: uses --webpack (monorepo .ts import resolution)

# Headless full games on testnet (real proofs + fees, several minutes):
BLACKOUT_TESTNET=1 pnpm --filter @zktable/blackout play
LIARS_TESTNET=1     pnpm --filter @zktable/liars-dice play
# (coup-lite has an equivalent gated play script — see games/coup-lite/README or src/play.ts)
```

---

## Architecture invariants (do not break)

1. **Prove off-chain, verify on-chain.** The prover never runs on-chain.
2. **Proofs are bound to authoritative state.** Each referee reconstructs a
   proof's public inputs from its OWN storage (e.g. the stored `c_old` + graph
   root), so a proof minted for a different position/graph/seed is rejected.
3. **Off-chain Poseidon must match the circuit.** `zktable-graph` uses
   `soroban-poseidon poseidon2_hash::<4,BnScalar>`, byte-identical to Noir's
   `Poseidon2::hash([a,b],2)` — validated by matching `bb`'s `public_inputs`
   output byte-for-byte. Never swap the hash without re-validating.
4. **Agents see only a `PlayerView`** (public state + own secret). This is what
   makes AI opponents cheat-proof; it is enforced by the shape of `Match.view()`.

---

## Known limitations / honest caveats (see docs/limitations.md)

- **`deck` v1 is a semi-honest committed deal** (PRD §7.2) — not full
  mental-poker/coSNARK security. The `card_membership` prove-hold-or-bluff proof
  IS load-bearing; the shuffle/deal trust is the documented simplification.
- **Referees have no `require_auth()` yet.** The demo is single-wallet /
  backend-orchestrated; the ZK proofs + on-chain referee are the trust anchor.
  Per-caller auth is the multiplayer hardening step (tracked). The AI Phantom
  proves server-side because the secret is its OWN — legitimate; browser proving
  (bb.js) is the path for a human playing the hidden role, deferred.
- **In-memory, single-process match store** in the web backend (demo scope).
- **Liar's Dice / Coup-lite on-chain demos are 2-player** (contracts support more;
  the core engine lacks an eliminated-player turn-skip hook).
- **Map is 100 nodes** (classic 199-node London topology is a stretch goal).

---

## Suggested next steps

1. ~~Referee `require_auth()` + Freighter-signed investigator moves~~ —
   **done (M8.1)**, testnet-verified multi-identity runs for all three games.
2. Browser proving via `bb.js` so a human can play the hidden role (Phantom).
   Spec: `docs/superpowers/specs/2026-07-03-browser-proving-design.md`.
3. ~~`valid_shuffle` circuit~~ — **done (M8.3)**: seed-forced shuffle +
   position-assigned hands; the dealer can no longer choose the deal (ADR 009).
4. Durable match store (Redis/DB) + matchmaking for the web app.
   Spec: `docs/superpowers/specs/2026-07-03-durable-store-design.md`.
5. ~~Multi-round elimination / engine turn-skip hook~~ — **done (M8.2)**:
   `turn.eliminated` in `@zktable/core`; Coup-lite 2–4p (3p on testnet),
   Liar's Dice 2–6p locally (the liars CONTRACT still locks 2p — see
   limitations §5 for the remaining contract workstream).
6. Liar's Dice referee multi-round protocol (per-round `dice_valid`
   re-rolls for survivors) to lift the contract's 2-player lock.
