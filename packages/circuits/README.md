# @zktable/circuits

Pre-built, reusable Noir (UltraHonk) circuits — one per zkTable ZK primitive —
plus TypeScript witness builders. Every game composes these; no game writes a
circuit.

## Circuits

| Circuit | Module | Proves | Status |
|---|---|---|---|
| `simple_circuit` | — | `x != y` (M0 pipeline anchor) | ✅ built |
| `fib_chain` | — | fibonacci chain (M0 second fixture) | ✅ built |
| `board/move_along` | `board` | legal hidden edge move on a graph | M2 |
| `hidden/predicate` | `hidden` | Poseidon commitment + predicate | M2 |
| `dice/dice_valid` | `dice` | fair PRF-derived hidden roll | M6 |
| `deck/valid_shuffle`, `deck/card_membership` | `deck` | valid shuffle + hand membership | M6 |
| `sealed` | `sealed` | commit-reveal (Poseidon equality, no circuit needed) | M6 |

## Building circuit artifacts

Requires `nargo` 1.0.0-beta.9 and `bb` v0.87.0 on PATH
(`$HOME/.nargo/bin:$HOME/.bb/bin`).

```bash
scripts/build_one.sh <circuit>     # e.g. board/move_along
scripts/build_all.sh               # all circuits
```

Each produces under `<circuit>/target/`: `proof` (14592 B), `public_inputs`,
`vk` (1760 B), plus `*_fields.json` variants.

**Proving is fixed to `--scheme ultra_honk --oracle_hash keccak`** — the
`keccak` oracle hash is required for the on-chain verifier. Do not change it.

Built `target/` artifacts are git-ignored; regenerate with the scripts above.

## Witness builders (TypeScript)

`src/` exposes typed witness builders that turn a game move + player view into a
circuit's `Prover.toml` inputs, so `@zktable/core` never hand-writes witnesses.
