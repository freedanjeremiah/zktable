# ADR 004 — Proofs are bound to the referee's own authoritative state

## Status
Accepted (M2, reused by every subsequent referee).

## Context
A ZK proof for, say, `move_along` is only meaningful if it's checked against
the *right* public inputs — the position commitment the piece actually has
on-chain right now, and the graph root the game was actually created with.
If a client were allowed to supply those public inputs directly alongside
the proof, a malicious or buggy client could submit a proof that's valid for
*some* `(c_old, root)` pair and try to smuggle in a different, stale, or
forged one.

## Decision
Every referee reconstructs a move's public inputs from its **own stored
state**, never from client-supplied values. Concretely: `submit_hidden_move`
reads the piece's current `c_old` commitment and the game's stored graph
root out of contract storage, builds `[c_old, c_new, ticket, root]` itself
(the client only supplies `c_new` and `ticket`, plus the proof bytes), and
verifies the proof against that self-constructed input. The same pattern
holds for `liars-dice-referee` (`seed` is recomputed from the referee's own
recorded nonce reveals, never trusted from a client) and `coup-referee`
(`public_inputs` built from the referee's own stored per-player
commitments).

## Consequences
- **Positive:** a proof can only ever be checked against the state the
  referee actually believes is true. This closes an entire class of bugs
  (replay against stale state, proofs bound to the wrong player, forged
  commitments) by construction rather than by an ad hoc client-side check.
  It is explicitly test-covered on every referee: `referee`'s
  `binding_rejects_proof_when_stored_c_old_differs` /
  `binding_rejects_proof_when_graph_root_differs`,
  `liars-dice-referee`'s `binding_rejects_proof_when_referee_seed_differs...`
  / `...wrong_player_index`, and `coup-referee`'s
  `binding_rejects_proof_for_a_different_claimed_character` /
  `...bound_to_a_different_players_commitments` — nine binding-rejection
  tests total, all passing.
- **Negative:** it means every referee needs its own bespoke "reconstruct
  the exact public-input layout this circuit expects" logic — there's no
  generic "verify any proof against any public inputs" entry point. This is
  an acceptable, even desirable, cost: it keeps the trust-critical
  reconstruction logic colocated with the state it reads.
- A related, still-open gap (see `docs/limitations.md`): none of the
  referees yet bind the *caller* to a Stellar `Address` via
  `require_auth()` — public inputs are bound to the referee's own state, but
  the referee doesn't yet check that the specific wallet calling
  `submit_hidden_move`/`bid`/`claim` is the wallet that actually owns that
  player seat. That is the next hardening step, not something this ADR's
  binding already covers.
