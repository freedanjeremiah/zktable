# @zktable/contracts

Soroban (Rust) on-chain layer for zkTable: the generic game **referee** contract
plus the **UltraHonk proof verifier** it depends on.

## Layout

```
crates/
  ultrahonk-verifier/   # pure-Rust UltraHonk verifier (BN254 host functions)
  test-utils/           # test helpers for the verifier
contracts/
  verifier/             # thin verifier wrapper contract (M0 anchor) — zktable-verifier
  referee/              # generic game referee (M2+)  [added in M2]
scripts/
  deploy_verifier.sh    # build + deploy + verify a circuit's proof on testnet
```

## Provenance

`crates/ultrahonk-verifier` and `contracts/verifier` are vendored from
[yugocabrio/rs-soroban-ultrahonk](https://github.com/yugocabrio/rs-soroban-ultrahonk)
(MIT). See `crates/ultrahonk-verifier/VERIFIER_PROVENANCE.md`. The verifier
implements UltraHonk verification in Rust using Stellar's BN254 host functions
(Protocol 26+). We treat it as an audited, load-bearing dependency and build the
zkTable referee on top of it unchanged.

## Toolchain (pinned — see repo `rust-toolchain.toml`)

- Rust **stable** (1.94+), target **wasm32v1-none** (soroban-sdk 26 rejects
  `wasm32-unknown-unknown`).
- `soroban-sdk` 26.0.1, `stellar` CLI 23+.
- Build with `cargo +stable build --release --target wasm32v1-none`. The
  `stellar contract build` wrapper may select the wrong toolchain — prefer the
  explicit cargo command above (already wired into `pnpm build`).

## Verifier contract API (`zktable-verifier`)

```rust
__constructor(vk_bytes: Bytes)                       // VK immutable at deploy
verify_proof(public_inputs: Bytes, proof_bytes: Bytes) -> Result<(), Error>
vk_bytes() -> Bytes
```

`PROOF_BYTES = 14592`. Contract error `#4` = `VerificationFailed`.

## Reproduce M0 (proof verified on live testnet)

```bash
# 1. build the circuit artifacts (proof / vk / public_inputs)
packages/circuits/scripts/build_one.sh simple_circuit
# 2. build + deploy the verifier and verify the proof on-chain
packages/contracts/scripts/deploy_verifier.sh simple_circuit alice testnet
```

A valid proof returns `null` (Ok); a tampered proof fails with contract error `#4`.

## Test

```bash
cargo +stable test        # native unit + Soroban-host integration tests (needs built circuit artifacts)
```
