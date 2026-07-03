# Limitations

zkTable is proven end-to-end on live Stellar testnet — three different
games, each ZK-verified on-chain, 234 TS tests + 84 Rust tests green. It is
a hackathon-scope SDK, not a production multiplayer platform. This document
is the itemized, honest account of where it falls short of that, with
pointers to the exact code and milestone reports so every claim here is
checkable.

## 1. `deck` v1 is a semi-honest committed deal, not full mental-poker

**What's real:** the `card_membership` Noir circuit
(`packages/circuits/card_membership/src/main.nr`) genuinely proves, in zero
knowledge, that a claimed character is one of the two cards in a player's
already-committed hand — without revealing which slot or the other card's
identity. This is load-bearing and proven on testnet: two real
`card_membership` "prove-hold" proofs, verified cross-contract, in the M6.3
Coup-lite on-chain run (`docs/milestones.md` M6.3).

**What's not real:** nothing proves the *deal itself* came from a fair,
unbiased shuffle over a shared, non-repeating deck. A designated
dealer/orchestrator (`games/coup-lite/src/runner.ts` in the on-chain demo)
supplies each player's commitments directly during the `Deal` phase.
Achieving full mental-poker/coSNARK-grade dealing would need a
`valid_shuffle` circuit (proving a permutation is a bijection over
`[0, N)`, specified but not implemented — PRD §7.2) run by a shuffler whose
honesty is itself distributed or provable. See
`docs/adr/007-deck-v1-semi-honest-deal.md` for the full design rationale.

**Practical impact:** trust a semi-honest dealer for Coup-lite's card
distribution. Do not use `deck` v1 for anything where a colluding dealer
matters (e.g. real-money card games).

## 2. Referee contracts have no `require_auth()` yet

Every referee shipped (`referee` for Blackout, `liars-dice-referee`,
`coup-referee`) identifies players by seat index or a stored commitment, not
by binding each move to the caller's Stellar `Address` via
`require_auth()`. In every on-chain run to date, one funded wallet (`alice`)
signs every transaction for every seat — documented explicitly in every
milestone report (e.g. m3-report.md: "Single funded wallet `alice` ... for
all seats (referee has no per-caller auth yet)").

**What this means concretely:** as shipped, any signer with access to a
referee contract could call `submit_hidden_move`/`bid`/`claim`/etc. on
behalf of *any* player index — the contract does not check that the caller
owns that seat.

**What still holds:** the ZK proofs and the referee's own state machine
(turn order, phase gating, proof-binding to the referee's own stored
commitments — see `docs/adr/004-proof-bound-to-authoritative-state.md`) are
real and enforced regardless of who calls. A malicious caller cannot forge
an illegal move or a false reveal; they could only (in a multi-wallet
deployment without this fix) act on behalf of a seat they don't legitimately
own. Per-caller `require_auth()` binding is the concrete hardening step
before real multiplayer with independent wallets per seat — a scoped,
well-understood addition to each referee's existing move-dispatch logic,
not an architectural rework.

## 3. Match state is in-memory and single-process

The web app's match store (`packages/web/lib/blackout/match-store.ts`) is a
`Map` attached to `globalThis`, scoped to one Node process. It survives
Next.js dev-server Fast Refresh reloads but not a server restart, and
doesn't work across multiple server instances. See
`docs/adr/006-per-match-referee-in-memory-store.md`. A production
deployment needs a persistent store (e.g. a database keyed by match ID,
storing the referee contract ID and roster) — this doesn't require changing
any referee's on-chain logic, only how matches are created and looked up.

## 4. The AI Phantom proves server-side, using its own secret — legitimate, but browser proving for a human in the hidden role isn't wired up

When an AI agent (heuristic or `ClaudeAgent`) plays a hidden role like
Blackout's Phantom, it proves its own moves server-side, through the exact
same `BoardProver`/`submit_hidden_move` path a human client would use (see
`docs/adr/008-ai-moves-through-same-proof-path.md`) — this is legitimate:
an agent proving knowledge of its *own* secret is no different in kind from
a human doing so.

What's genuinely missing: a **human** playing a hidden role (e.g. a human
Phantom, rather than an AI one) needs the proof generated client-side, in
the browser, so their secret never leaves their machine even to a trusted
server. Noir + `bb.js` is browser-capable (PRD §14) and the SDK's proof
orchestration is designed to support it, but the web app's proving pipeline
today runs server-side only — a human playing Blackout is always seated as
an Investigator (a public-move role), never as the Phantom.

## 5. Liar's Dice and Coup-lite's on-chain demos are 2-player

- **Liar's Dice:** the `liars-dice-referee` contract's constructor
  hard-rejects any `n_players != 2` (`Error::UnsupportedConfig`). This is a
  deliberate soundness choice, not an oversight: a single elimination round
  is only a complete, sound game when it starts from exactly 2 players
  (eliminating one always leaves exactly 1 alive — a definitive winner,
  with no need to re-roll for a following round). Multi-round elimination
  tournaments (re-roll + re-seed per round for surviving players) are
  flagged as a scoped, structurally-supported follow-up in the M6.2 report,
  not attempted here.
- **Coup-lite:** the `coup-referee` contract itself natively supports 2–4
  players (its constructor validates `2 <= n_players <= 4`, and a real
  3-player native test exercises a proof-binding-rejection scenario). The
  *shippable showcase* (`games/coup-lite/src/coup-lite.ts`'s `defineGame`
  and its on-chain demo) is fixed at 2 players, because `@zktable/core`'s
  generic turn engine doesn't yet have an "skip an eliminated player's
  turn" hook that Coup-lite's elimination model needs for 3+ players. The
  contract is more general than the demo exercising it.

## 6. Blackout's map is 100 nodes, not the classic 199-node topology

`games/blackout/map/city.json` is a deterministic, custom-generated 100-node
transit graph (taxi/bus/rail), chosen for build and on-chain proving
performance within this build's timeline. The classic 199-node London
topology was explicitly named a stretch goal in the PRD (§12.1, §19) and
was not attempted.

## 7. No anti-replay protection on proof verification

Noted specifically in the Coup-lite report (M6.3): `prove_hold`'s proof
verification is stateless — the same valid proof can be resubmitted for
another challenge round on the same underlying claim. The M6.3 on-chain
demo relies on this directly (the same real proof, generated once, is
submitted for two separate challenge rounds in that run, since the
underlying claim didn't change). This is inherited from the same stateless
`verify_proof` pattern every referee uses (see
`docs/adr/003-vendor-ultrahonk-verifier.md`). Fine for a demo/testnet
showcase; worth addressing (e.g. a per-move nonce bound into public inputs)
if this pattern is used somewhere replay genuinely matters.

## What this list deliberately does not include

Everything in `docs/milestones.md` is real, on-chain, and independently
checkable — every contract ID cited there resolves on
`stellar.expert/explorer/testnet`, every test count was re-verified while
writing these docs (234 TS tests across 7 packages via `pnpm -r test`; 84
Rust tests via `cargo +stable test --workspace` in `packages/contracts`).
The limitations above are genuine scope boundaries and known gaps, not
disclaimers about whether the ZK claims themselves are true.
