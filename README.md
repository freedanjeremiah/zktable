# zkTable

> A TypeScript SDK for building trustless, privacy-preserving board games on
> Stellar. Declare a game; get zero-knowledge privacy, an on-chain referee, and
> cheat-proof AI opponents — without writing a circuit.

See [`PRD.md`](./PRD.md) for the full design and [`docs/milestones.md`](./docs/milestones.md)
for build progress with on-chain evidence.

## Packages

| Package | What |
|---|---|
| `@zktable/core` | SDK: `defineGame`, engine, proof orchestration, agent harness |
| `@zktable/circuits` | Pre-built Noir (UltraHonk) circuits + witness builders |
| `@zktable/contracts` | Generic Soroban referee + vendored UltraHonk verifier (Rust) |
| `@zktable/agents` | `Agent` interface, `HeuristicAgent`, `ClaudeAgent` |
| `@zktable/web` | Next.js arcade app |
| `games/*` | `blackout` (flagship), `liars-dice`, `coup-lite` |

## Prerequisites

- Node ≥ 20, pnpm 10
- Rust stable + `wasm32v1-none` target
- Noir `nargo` 1.0.0-beta.9, Barretenberg `bb` v0.87.0 (`~/.nargo/bin`, `~/.bb/bin`)
- Stellar CLI 23+ with a funded testnet identity (`stellar keys generate alice && stellar keys fund alice --network testnet`)

## Quick start

```bash
pnpm install
pnpm build
pnpm test
# Prove the ZK-on-Stellar pipeline end-to-end on testnet:
packages/circuits/scripts/build_one.sh simple_circuit
packages/contracts/scripts/deploy_verifier.sh simple_circuit alice testnet
```
