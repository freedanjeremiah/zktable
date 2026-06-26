# zkTable — Milestone Log

Running record of completed build milestones (PRD §18) with on-chain evidence.

## M0 — Scaffold & prove the pipeline works ✅

**Done:** 2026-07-03. The full Noir → UltraHonk → Soroban pipeline verifies a real
proof inside a live testnet contract, and rejects a tampered one.

- Monorepo scaffolded: pnpm workspaces + Turborepo, `rust-toolchain.toml` pinned
  to stable / `wasm32v1-none`, base tsconfig.
- Vendored the pure-Rust UltraHonk verifier (BN254 host functions) into
  `@zktable/contracts` as `crates/ultrahonk-verifier` + the `zktable-verifier`
  wrapper contract. 9/9 native + Soroban-host tests pass.
- `@zktable/circuits` holds Noir circuits + build scripts; `simple_circuit` and
  `fib_chain` build to real `proof`/`vk`/`public_inputs`.

**On-chain evidence (Stellar testnet, Protocol 27):**

| What | Value |
|---|---|
| Verifier contract | `CDLQFMXZCDKDIBAAX742TNNFGY2SYOVHT6A3URKJHZTS7FSBEXM5YKEZ` |
| Valid-proof verify tx | `0f3ea548a9953442ae2ff11d62cf27e49035b2be051a12a0f9cb69a11d8db32f` |
| Deploy tx | `67e0d4ae6ccb68e7e9f43a7b1f8f8e4a5fc7b955a09acf2e6365dcb9dca3c1e2` |
| Tampered proof | rejected — `Error(Contract, #4)` (`VerificationFailed`) |

Reproduce: `packages/contracts/scripts/deploy_verifier.sh simple_circuit alice testnet`

## M1 — `@zktable/core` engine skeleton ✅

**Done:** 2026-07-03 (commit `26eab2c`). Declarative `defineGame`, deterministic
turn/state engine, legal-move enumeration, per-player `PlayerView` (own secret
only), reveal-checkpoint + win-detection seams, and a `zk.*` marker namespace.
Fully-public tic-tac-toe plays to completion. 66 Vitest tests pass; `tsc` + `tsup`
clean. No ZK yet — clean seams left for M2 (`submit` proof binding, `commitments`
map, reveal flow).

## M2 (in progress) — `board` module + `move_along` circuit

**ZK core done + on testnet:** the `move_along` Noir circuit (hidden position →
hidden position along a legal graph edge) proves and verifies on live testnet.
The off-chain edge-tree/witness builder (`zktable-graph`, using soroban-poseidon)
produces Poseidon hashes **byte-identical** to the circuit — verified by matching
bb's `public_inputs` to the tool's output exactly.

| What | Value |
|---|---|
| `move_along` verifier contract | `CCTNXQP6TAYPRYIJKP6MPJZUUPNVMV6BQID4NHLSCYKWK3JZEBAGFWEO` |
| Legal hidden move | proof verified on-chain (`null`/Ok) |
| Illegal edge | rejected off-chain (no valid witness) |
| Public-input layout | `[c_old, c_new, ticket, root]` (128 B) — matches bb |

## M2 — `board` module + `move_along` circuit + generic referee ✅

**Done:** 2026-07-03. The full hidden-movement stack works on live testnet.

- **`move_along` circuit** (commit `d69956d`): hidden→hidden move along a legal
  graph edge; Poseidon2 commitments + depth-10 edge-Merkle membership.
- **`zktable-graph` tool** (commit `d69956d`): off-chain edge-tree/witness/commitment
  builder; Poseidon byte-identical to circuit (bb `public_inputs` match exactly).
- **TS `board` module** `@zktable/circuits` (commit `396b1b1`): `BoardGraph` +
  `BoardProver` generate & verify real UltraHonk proofs; 9 tests.
- **`zktable-referee` contract** (commit `773226a`): binds each proof to its OWN
  stored `c_old` + graph root before cross-contract-verifying; enforces turn
  order, roles, tickets, reveal/capture. 11 native tests incl. a real
  cross-contract proof verification + binding-rejection (wrong c_old / wrong root).

**On-chain evidence (testnet) — a ZK-verified hidden move through the referee:**

| What | Value |
|---|---|
| Referee contract | `CDZFHUWWIXKCIKZIWNV3AEC4MHBED3FQL3VS2JIUXC6OPFI57CJ7JOPL` |
| move_along verifier | `CCFSPUAXSXAA5Y7YOGVNCZFJFF67J2AYRT25YHM2O6CNQFRFCHGZYDK4` |
| `submit_hidden_move` tx | `a0a2e1193508beab25f5962ffab1011edccc31c13509bbc6332164f78e376af1` (Ok) |
| State after | phantom commitment → `c_new`, taxi 10→9, `ticket_feed=[0]`, turn→investigator |

Known gap: referee has no `require_auth()` yet (fine for headless single-wallet;
harden before multiplayer — tracked).
