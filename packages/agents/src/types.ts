import type { Move, PlayerView } from '@zktable/core'

// The game-agnostic AI agent contract for zkTable. This is the entire
// surface an AI opponent gets: a `PlayerView` (public state + only ITS OWN
// secret, per @zktable/core's `Match.view`) and the enumerated `legalMoves`
// for this turn. There is no back door to other players' secrets, the raw
// `MatchState`, or the engine internals — an agent built against this
// interface is exactly as capable of cheating as a human clicking buttons
// in a UI: not at all. See the anti-cheat test in `anti-cheat.test.ts`.

/** A game/engine event an agent may optionally observe (chat, reveals, opponent moves, ...). */
export type GameEvent = { type: string; [k: string]: unknown }

/**
 * Implemented by every AI opponent, regardless of game. `act` must resolve
 * to one of the moves in `legalMoves` — implementations are expected to
 * validate this themselves (see `assertLegalMove` in `move-utils.ts`) rather
 * than relying on the engine to catch it, so illegal choices fail loudly at
 * the agent boundary instead of silently inside `Match.submit`.
 */
export interface Agent {
  act(view: PlayerView, legalMoves: Move[]): Promise<Move>
  /** Optional hook for agents that want to react to game/chat events between turns. */
  observe?(event: GameEvent): void
}
