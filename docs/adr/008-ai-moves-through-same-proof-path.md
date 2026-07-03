# ADR 008 — AI agents move through the exact same proof path as humans

## Status
Accepted (PRD §10.2, "the anti-cheat invariant"; implemented at M5/M4b).

## Context
An AI opponent for a hidden-information game is only trustworthy if it
can't secretly cheat — e.g. by having server-side code read an opponent's
secret state, or by writing a move directly into contract storage without
going through the same legality/proof checks a human's client would. The
prior ZK-gaming hackathon's field explicitly called out "no god-mode
server" as a real failure mode to avoid (PRD §2, §17).

## Decision
Two structural guarantees, both enforced by code shape rather than by
agent-side discipline:

1. **`PlayerView` cannot carry another player's secret.** `Match.view()` in
   `@zktable/core` constructs a view containing only public state and the
   requesting player's own secret; there is no field on the object that
   *could* hold another player's data (no `players`/`opponents`/`secrets`
   map). Every `Agent.act(view, legalMoves)` call — `HeuristicAgent`,
   `RandomAgent`, `ClaudeAgent` alike — receives exactly this and nothing
   more.
2. **An AI's move is proven exactly like a human's.** When an AI Phantom in
   Blackout chooses a hidden move, the same `BoardProver`/`submit_hidden_move`
   path a human client would use builds the witness, generates a real
   UltraHonk proof, and submits it to the referee. There is no separate,
   unproven "AI move" code path anywhere in the stack.

## Consequences
- **Positive:** this is a code-shape guarantee, test-covered directly.
  `@zktable/agents`' `anti-cheat.test.ts` asserts, for a game where each
  player has a distinct secret, that a `RecordingAgent` never observes the
  other seat's secret value — checked structurally (`Object.keys`), not just
  by absence of a specific field, and reinforced by a raw
  `JSON.stringify(view)` scan. On testnet, every AI-Phantom move across the
  M4b/M4c acceptance runs is a real, independently-verifiable
  `submit_hidden_move` transaction with a fresh proof — there is nothing to
  "trust" about the AI's honesty beyond what the ZK proof already
  guarantees for any player, human or not.
- **Negative:** this constrains agent design — an agent literally cannot use
  lookahead over hidden opponent state, even for a stronger AI, without
  breaking the guarantee. That's treated as a feature, not a limitation:
  the whole point of the demo is that no player, including the AI, has an
  information advantage the ZK boundary doesn't allow.
- Today, "AI proves through the same path" is demonstrated for AI seats
  proving their **own** secret (e.g. an AI Phantom). A human playing that
  same hidden role still needs client-side (browser) proving, which isn't
  wired into the web app yet — see `docs/limitations.md`. This ADR's
  guarantee is about who gets to see what and how moves are authorized, not
  about where proving happens; both AI and human provers are bound by the
  same `PlayerView` boundary either way.
