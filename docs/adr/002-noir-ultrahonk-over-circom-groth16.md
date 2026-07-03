# ADR 002 — Noir/UltraHonk over Circom/Groth16

## Status
Accepted (PRD §15, §19 "[DECIDED] Noir over Circom").

## Context
Two realistic circuit stacks were available for Stellar: Circom → Groth16
(smaller, cheaper-to-verify proofs; a more idiosyncratic, lower-level DSL)
and Noir → UltraHonk (Rust-like, readable DSL; larger, costlier-to-verify
proofs, but Barretenberg's `bb`/`bb.js` toolchain is browser-capable and
Stellar Protocol 25/26 shipped native BN254 host functions that make
UltraHonk verification meaningfully cheaper on-chain).

## Decision
Build every zkTable circuit in Noir, proved with UltraHonk (`bb`), verified
on-chain via a vendored pure-Rust UltraHonk verifier contract. Abstract the
proof system behind each module's TS API (`zk.board.moveAlong`, etc.) so an
individual hot circuit could be ported to Circom/Groth16 later without
changing any game-definition code, if verification cost ever became a
blocker.

## Consequences
- **Positive:** every circuit in this repo (`move_along`, `dice_valid`,
  `card_membership`, plus the M0 sanity circuits) was authored, tested, and
  proven on live testnet in Noir with no Circom code anywhere. Developer
  velocity on circuit logic (readable asserts, in-circuit range checks,
  `#[test]` blocks executed by `nargo test`) was high — e.g. `dice_valid`'s
  two-sided range-check trick for a sound mod-6 reduction was written,
  tested, and verified end-to-end in one milestone.
- **Negative:** UltraHonk proofs are larger than Groth16's (14592 bytes for
  every circuit shipped here, regardless of circuit size at this scale) and
  costlier to verify on-chain. This was accepted as a deliberate trade for
  Noir's DX; the fallback lever (per-module proof-system swap) exists but
  was never exercised — no circuit proved too expensive to verify on
  testnet in this build.
- The vendored verifier crate (`crates/ultrahonk-verifier` in
  `@zktable/contracts`) is now a shared dependency of every referee
  contract; see ADR 003 for why it was vendored rather than consumed as an
  external dependency.
