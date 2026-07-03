# ADR 003 — Vendor the pure-Rust UltraHonk verifier

## Status
Accepted (M0).

## Context
Verifying a Noir/UltraHonk proof inside a Soroban contract needs pairing
and multi-scalar-multiplication arithmetic over BN254. Stellar Protocol 25
("X-Ray") and 26 ("Yardstick") added native BN254 host functions precisely
so this arithmetic doesn't have to be reimplemented in WASM — but there
still needs to be a Soroban contract that calls those host functions in the
right sequence to check an UltraHonk proof against a verification key and
public inputs. A reference implementation existed
([`yugocabrio/rs-soroban-ultrahonk`](https://github.com/yugocabrio/rs-soroban-ultrahonk)).

## Decision
Vendor the pure-Rust UltraHonk verifier directly into `@zktable/contracts`
(`crates/ultrahonk-verifier`) rather than consuming it as an unpinned
external git dependency, and wrap it in a small `zktable-verifier` contract
crate that every game's referee calls cross-contract to check a proof.

## Consequences
- **Positive:** the verifier's exact behavior is pinned and test-covered in
  this repo (9 native + Soroban-host tests at M0; still passing at M7 —
  `cargo +stable test --workspace` — 84 tests total across the verifier and
  all three referee crates). Every referee (`referee` for Blackout,
  `liars-dice-referee`, `coup-referee`) deploys its own `zktable-verifier`
  instance loaded with its own circuit's VK, so a bad VK or a broken
  verifier build for one game can never affect another game's contract.
- **Negative:** vendoring means upstream fixes to the reference verifier
  don't arrive automatically; any bug found in the vendored copy has to be
  fixed here directly. This was accepted because the core cryptographic
  surface (BN254 host function calls) is small and test-covered, and the
  M0 acceptance gate ("a test submits a proof to a live testnet contract
  and gets `true`; a wrong proof gets `false`") already proved the vendored
  copy works correctly before any game was built on top of it.
- Every referee's `verify_proof` follows the same pattern: reconstruct
  `public_inputs` from the referee's *own* stored state (see ADR 004), then
  `try_invoke_contract` into its `zktable-verifier` instance with
  `(public_inputs, proof)` and branch on the result.
