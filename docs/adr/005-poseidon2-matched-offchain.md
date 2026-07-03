# ADR 005 — Match Poseidon2 off-chain via `soroban-poseidon`, byte-identically

## Status
Accepted (M2, reused by every hashing/commitment path since).

## Context
Every commitment in zkTable (`C = Poseidon(value, salt)`) has to be computed
identically in three places: inside the Noir circuit (which hashes with
Barretenberg's Poseidon2 implementation), by the off-chain witness-building
tool that prepares proof inputs, and — implicitly, when the referee
reconstructs public inputs per ADR 004 — by the Soroban contract itself via
Stellar's native Poseidon host function (Protocol 25). If any of the three
disagreed even in hash-input ordering or field encoding, proofs would fail
to verify or, worse, silently verify against the wrong logical value.

## Decision
Use the `soroban-poseidon` crate's `poseidon2_hash` in the off-chain
Rust tool (`zktable-graph`) for every commitment/hash the tool computes, and
treat "byte-identical to `bb`'s own public-input encoding" as a required,
independently-checked property of every new hash usage, not an assumption.

## Consequences
- **Positive:** this was verified, not asserted, at every module's
  introduction. `board`'s M2 report confirms `zktable-graph`'s Poseidon
  output matches `bb`'s `public_inputs` byte-for-byte. `dice_valid` (M6.1)
  re-ran the same check for its `hash2` usage (seed fold, per-die hash,
  commitment) across two independent seed/salt combinations. `card_membership`
  (M6.3) re-ran it again. Zero hash-mismatch bugs surfaced in any of the
  three modules' real proof/verify round-trips on testnet.
- **Negative:** every new circuit that introduces a new hash *shape* (a new
  argument order, a new number of hashed fields) has to re-derive and
  re-verify the off-chain match by hand — there's no automatic
  cross-language hash-compatibility test harness. This was accepted as a
  manageable, low-frequency cost given only three circuits exist.
- The fold order for multi-input hashes (e.g. the dice module's joint-seed
  left-fold `hash2(hash2(hash2(0, n_0), n_1), n_2)...`) is a specific,
  load-bearing convention that must match exactly between the tool, the
  circuit, and the referee's own recomputation (per ADR 004) — documented
  explicitly in each module's report and circuit source comments.
