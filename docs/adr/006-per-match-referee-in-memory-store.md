# ADR 006 — Per-match referee deploy + in-memory match store (demo scope)

## Status
Accepted for the current demo scope; flagged as a hardening item before
production (see `docs/limitations.md`).

## Context
A production multiplayer platform would likely deploy one long-lived
referee contract instance and route many matches/games through it (or use a
factory pattern), and would persist match/session state in a durable,
multi-instance-safe store. Building that was out of scope for proving the
SDK is real within this build's timeline.

## Decision
Every match — Blackout, Liar's Dice, or Coup-lite, whether run headlessly
via a game's `play` script or through the web app's match API — deploys a
**fresh** verifier + referee contract pair for that one match, and the web
app tracks in-flight matches in an **in-memory** `Map` attached to
`globalThis` (`packages/web/lib/blackout/match-store.ts`), scoped to a
single Node process.

## Consequences
- **Positive:** this is the simplest possible design that still produces
  genuine, independently-verifiable on-chain evidence per match — every
  milestone report's on-chain transcript is a real, freshly-deployed
  contract instance, not a shared long-lived one whose state could be
  confused across runs. It also sidesteps any need for a per-game
  multiplexing/routing layer inside a single contract, keeping each
  referee's logic focused on exactly one game's rules.
- **Negative:** deploying a fresh contract pair per match is slow (observed
  15–120+ seconds of real testnet latency per match creation in the M4b/M4c
  reports) and burns testnet fees per match. The in-memory store means a
  server restart loses every in-flight match, and the design doesn't
  horizontally scale past one process.
- This is explicitly a demo-scope decision, not a technical ceiling: a
  factory/registry contract pattern and a persistent store (e.g. a database
  keyed by match ID, storing the referee contract ID) are both
  straightforward follow-ups that don't require changing any referee's core
  logic — only how matches are created and looked up.
