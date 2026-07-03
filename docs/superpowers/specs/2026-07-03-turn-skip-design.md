# Design: Engine turn-skip hook + multi-round elimination

**Status:** approved for implementation (M8.2)
**Handoff item:** #5 — "Multi-round elimination for Liar's Dice / Coup-lite
(needs a core engine turn-skip hook for eliminated players)."

## Problem

`advanceTurn` (`packages/core/src/engine.ts:251`) is pure round-robin over a
fixed `order` array with no notion of player status; `MatchState.players`
entries have no eliminated flag. Both showcase games dodge this by hardcoding
`N_PLAYERS = 2` so elimination instantly ends the match (documented at
`games/coup-lite/src/coup-lite.ts:30-48`). Coup-lite's win rule
(`alivePlayers().length === 1`) is already N-player-general; Liar's Dice's
winner pick (`players.find(p => p.id !== loser)`, `liars-dice.ts:188`) is not.

## Goal

A declarative, game-supplied elimination predicate that the engine consults
when advancing turns, plus both games generalized to N players with real
elimination: Coup-lite 2–4 players (its on-chain referee already supports
2–4), Liar's Dice N players with multi-round die-loss.

## Non-goals

- Extending the Liar's Dice **referee contract** past its hard 2-player /
  5-dice / 6-sides lock (`Error::UnsupportedConfig`). The on-chain Liar's
  Dice demo stays 2-player single-round; the contract workstream is noted in
  limitations. (The coup referee needs no change — it already skips dead
  seats on-chain.)
- Rejoin/resurrection mechanics.

## Design

### Core engine

New optional definition hook, mirroring the existing declarative style:

```ts
turn: {
  order: TurnOrder
  eliminated?: (state: MatchState, playerId: PlayerId) => boolean
  moves: Record<string, MoveSpec>
}
```

- Pure predicate over `MatchState` (games already track elimination in their
  own `public` state — no new engine-owned mutable state, no `setEliminated`
  API, nothing to serialize).
- `advanceTurn` becomes: walk `order` from the current seat, skipping seats
  for which `eliminated(state, id)` is true; `round` increments when the walk
  crosses the start of `order` (same wrap semantics as today, counting
  skipped seats as crossed). If **every** other seat is eliminated the turn
  stays put — by then `end()` must return an outcome; if it doesn't, the
  engine throws (`'all players eliminated but end() returned null'`) rather
  than looping.
- `legalMoves(playerId)` returns `[]` for an eliminated player (defensive;
  an eliminated seat can never be `turn.current` anyway after this change).
- `define-game.ts` validates `turn.eliminated` is a function when present.
- The unconsumed `turn.phases` field stays untouched (out of scope).

### Liar's Dice → N players, multi-round

Public state reshaped (local/TS game only):
- `diceCount: Record<PlayerId, number>` (start `DICE_PER_PLAYER` each),
  `roundNumber`, and per-round `rolls` keyed by player replace the
  single-round fields. `eliminated`/`winnerId` become derived:
  `turn.eliminated = (s, p) => s.public.diceCount[p] === 0`.
- Challenge resolution: loser loses one die (not the game). If the loser
  still has dice, a new round starts (fresh rolls for all alive players,
  bidding reset, loser opens). A player at 0 dice is eliminated.
- `end`: last player with dice wins (alive-based — fixes the
  `find(p => p.id !== loser)` 2-player assumption).
- `N_PLAYERS` becomes a `config.players` default (2, range 2–6);
  `strategy.ts` `totalDiceInPlay` reads live `diceCount` instead of the
  constant.
- Local re-rolls use the existing deterministic per-round seed pattern from
  `stepLocalMatch` (round number mixed into the seed).

### Coup-lite → N players

- `players: { min: 2, max: 4 }` (matches the referee). `challenge.legal`
  keeps the "next active seat may challenge or claim" rule — now correct for
  N players because *next active* is skip-aware.
- `turn.eliminated = (s, p) => (s.public.influenceByPlayer[p] ?? 0) === 0`.
- Reducers already N-safe (`alivePlayers`, survivor-count win rule); the
  `eliminated: PlayerId | null` scalar becomes a list `eliminatedIds` so two
  eliminations don't overwrite each other.
- Runner/on-chain path: `COUP_PLAYERS=3` (or 4) plays a >2-player match on
  testnet against the unmodified referee — this is the acceptance evidence.

## Testing

- Core (`engine.test.ts`): 4-player fixtures — skip one eliminated seat;
  skip consecutive eliminated seats; wrap + round increment with skips;
  turn stays put + throw when `end()` is null with one survivor; predicate
  absent ⇒ behavior byte-identical to today (regression).
- Liar's Dice: 3-player local full game to elimination + win; die-loss
  round transitions; bid state resets per round; 2-player behavior preserved.
- Coup-lite: 3-player local game where an eliminated player is skipped and
  survivor-of-3 wins; `eliminatedIds` accumulates.
- Testnet: 3-player Coup-lite full match (real proofs) recorded in
  `docs/milestones.md` (M8.2 evidence).
