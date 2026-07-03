# Design: Browser proving via bb.js — human plays the Phantom

**Status:** approved for implementation (M8.5)
**Handoff item:** #2 — "Browser proving via `bb.js` so a human can play the
hidden role (Phantom)."

## Problem

Proving is 100% server-side: `BoardProver` shells out to `zktable-graph`
(Rust: Poseidon2 commitments + depth-10 Merkle path), `nargo execute`, and
`bb prove --scheme ultra_honk --oracle_hash keccak`
(`packages/circuits/src/prover.ts:113-190`). A human can therefore only play
Investigators — playing the hidden role would mean sending their secret
position to the server (`docs/limitations.md` §4, ADR 008). No
`@noir-lang/*` or `@aztec/bb.js` dependency exists anywhere yet.

## Goal

A human plays Blackout **as the Phantom** in the browser: their position and
salts never leave the machine; the browser computes the witness, generates a
real UltraHonk (keccak-oracle) proof with bb.js, and only `{c_new, ticket,
proof}` goes to the server for on-chain submission. The proof must verify in
the same on-chain verifier as server-side proofs — byte-compatible, same VK.

## Non-goals

- Browser proving for Liar's Dice / Coup-lite (same recipe, later).
- Removing the server from *submission* (tx signing/submission still goes
  through the existing referee client; M8.1's Freighter flow covers auth).
- Multithreaded WASM tuning. Single-threaded bb.js is acceptable if a
  move_along proof lands under ~30 s in-browser; COOP/COEP headers are added
  so threads are used where available, but perf work beyond that is out.

## Design

### New package: `@zktable/prover-web` (`packages/prover-web`)

Browser-only proving library, kept out of `@zktable/circuits` (which is
Node-only by design — its API shells out to CLIs and stays the toolchain
source of truth).

- **Deps (pinned to the toolchain):** `@noir-lang/noir_js@1.0.0-beta.9`
  (ACVM witness solving — replaces `nargo execute`) and
  `@aztec/bb.js@0.87.0` (proving + Poseidon2 — replaces `bb prove`).
  Versions must match the CLI pins in `scripts/build_all.sh:4-5`; a comment
  ties them together.
- **API:**
  ```ts
  createWebProver(artifacts: { acir: CompiledCircuit; vk: Uint8Array; graph: GraphData })
    → {
        commit(node: number, salt: bigint): Promise<Hex32>          // Poseidon2(node, salt)
        prove(move: {from, to, ticket, saltOld, saltNew}): Promise<BoardProof>
        verifyLocally(proof): Promise<boolean>
      }
  ```
  `BoardProof` matches the existing shape (`proof: Uint8Array(14592)`,
  `publicInputs: Uint8Array(128)`, `cOld`, `cNew`, `root`, `ticket`).
- **Witness inputs in TS:** Poseidon2 comes from bb.js's own
  `poseidon2Hash` (same Barretenberg implementation the circuit and
  `soroban-poseidon` match — architecture invariant #3 holds because all
  three are Barretenberg-derived; verified by a golden-vector test, below).
  The edge Merkle tree is built in TS from the same `graph.json` the Rust
  tool consumes: canonical edge encoding, leaf hashing, depth-10 tree, path
  extraction — a direct port of `graph-tools` `build_tree`/`merkle_path`
  (`main.rs:128-175`).
- **Proving:** `Noir(acir).execute(inputs)` → witness;
  `UltraHonkBackend(acir.bytecode).generateProof(witness, { keccak: true })`.
  If the bb.js 0.87 API surfaces keccak differently (e.g.
  `generateProofForRecursiveAggregation` vs options object), the adapter
  isolates that in one function; the acceptance test pins the real behavior
  against the CLI verifier.

### Artifact delivery

- `move_along.json` (ACIR) and `vk` are copied at build time into
  `packages/web/public/circuits/move_along/` by a small predev/prebuild
  script in `packages/web` (they're gitignored build products; the script
  errors with "run build_all.sh" if missing). The city `graph.json` is
  already static app data.

### Web flow (Phantom-as-human)

- Match creation gains `phantomSeat: 'human'` (default stays `'ai'`).
  When human: the server does **not** generate the Phantom start
  position/salt; instead the create response marks the seat, and the
  browser generates position + salt locally (webcrypto), computes the
  commitment via `commit()`, and POSTs it to a new route that calls the
  existing `set_hidden_start` path. Server-held `phantom` secret state is
  absent for human-phantom matches (`match-store` record allows it null).
- Phantom turn: browser picks a move (existing shadow/board UI already
  renders the map), proves locally (progress indicator — "proving ~10-30 s"
  states), then POSTs `{cNewHex, ticket, proofHex}` to
  `POST /api/blackout/matches/[id]/phantom-move`, which submits via the
  existing `client.submitHiddenMove` and advances AI turns. The server
  never sees `to`/salt.
- Reveal rounds: the referee's reveal check needs `(node, salt)` — the
  browser POSTs them only at reveal checkpoints (public by design at that
  moment), reusing the existing `reveal` path.
- Local mirror: for human-phantom matches the server's `local` Match keeps
  the Phantom secret empty; shadow inference for investigators already
  works from the public ticket feed (it never used the secret).

### Headers / bundling

- `next.config.ts` gains COOP/COEP headers on `/play/blackout` (and the
  route serving WASM) so bb.js can use SharedArrayBuffer threads when
  available; the code must still work without them (bb.js falls back).
- bb.js + ACIR load lazily (dynamic import on seat selection) so the
  landing/lobby pages don't pay the WASM download.

## Milestone gate (sequenced first)

**Step 0 of implementation is a parity spike:** in a vitest (Node) run,
`@zktable/prover-web` proves a fixture move and the proof must (a) pass
bb.js `verifyProof` with the CLI-generated VK, and (b) pass `bb verify`
CLI on disk, and (c) its `publicInputs` must equal `zktable-graph witness`'s
`public_inputs` byte-for-byte for the same inputs. If bb.js 0.87.0 cannot
produce a CLI-compatible keccak UltraHonk proof, stop and re-plan (known
risk; everything else in this spec depends on it).

## Testing

- Golden vectors: TS Poseidon2/commit/root outputs vs committed
  `zktable-graph` outputs for the fixture graph (the invariant test).
- Parity spike test above, kept as a permanent regression test (Node-side,
  no browser needed — bb.js runs in Node too).
- Route tests: phantom-move route rejects when seat isn't human-phantom or
  proof hex malformed.
- Manual acceptance: full browser match as human Phantom on testnet — on-
  chain verified hidden moves + a reveal checkpoint, recorded in
  `docs/milestones.md` (M8.5), plus limitations §4 and ADR 008 updated.
