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
