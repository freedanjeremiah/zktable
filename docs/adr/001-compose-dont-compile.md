# ADR 001 — Compose, don't compile: a fixed primitive vocabulary

## Status
Accepted (PRD §4, decided before M0).

## Context
The most tempting version of "a general ZK board-game SDK" is
auto-synthesis: a developer declares arbitrary custom hidden-state rules and
the SDK generates a bespoke circuit for them. That is a research project —
general circuit synthesis from a high-level DSL is unsolved at production
quality — and would have sunk this build's timeline entirely.

## Decision
Ship a small, fixed vocabulary of five ZK primitives — `board`, `dice`,
`deck`, `hidden`, `sealed` (PRD §4, §7) — each backed by one pre-built,
audited Noir circuit (or a small family of them). Developers express a game
by *composing* these primitives declaratively via `defineGame`; they never
write a circuit. Generality comes from richness of composition, the same way
boardgame.io or a query builder gets open-ended power from a fixed operator
set, not from magic synthesis.

## Consequences
- **Positive:** every circuit in the system is pre-built, testable, and
  reused across every game (`move_along` powers Blackout; `dice_valid`
  powers Liar's Dice; `card_membership` powers Coup-lite) — three visibly
  different games shipped on the same five-primitive vocabulary with zero
  hand-written circuits at the game-definition layer.
- **Negative:** a game whose hidden-information shape doesn't fit any of the
  five primitives (or a composition of them) cannot be expressed without
  extending the SDK itself. A Noir escape hatch for advanced/custom circuits
  was considered but explicitly deferred past v1 (PRD §3.2).
- This is the single decision the rest of the architecture hangs off: the
  on-chain referee, the AI agent harness, and the `PlayerView` boundary all
  assume "moves are either public, or bound to exactly one of these five
  proof types."
