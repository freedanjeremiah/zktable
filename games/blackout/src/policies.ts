// M5b — Blackout AI policies. Adapts the deterministic `strategy.ts`
// heuristics (`phantomMove`/`investigatorMove`) to the `(view, legalMoves) =>
// Move` shape `@zktable/agents`' `HeuristicAgent` (and, structurally, any
// `Policy`) expects, so an AI seat — phantom or investigator — plays through
// exactly the same `PlayerView` boundary a human would see. This file does
// NOT import `@zktable/agents` (kept a devDependency, used only in tests) so
// `@zktable/blackout` stays free of a production dependency on the agent
// harness; `BlackoutPolicy` matches `@zktable/agents`' `Policy` type
// structurally, so `new HeuristicAgent(blackoutPhantomPolicy)` just works.

import type { Move, PlayerView } from '@zktable/core'
import { cityGraph } from './map.js'
import { investigatorMove, phantomMove } from './strategy.js'

/** Structurally identical to `@zktable/agents`' `Policy` type. */
export type BlackoutPolicy = (view: PlayerView, legalMoves: Move[]) => Move

/**
 * Derives a per-call seed from the view's own content (public state + own
 * secret + the move count), so the same game position always yields the same
 * choice (deterministic given a fixed history) without threading an explicit
 * seed through the `Policy` signature, which — per `@zktable/agents` — takes
 * only `(view, legalMoves)`.
 */
function seedFromView(view: PlayerView, tag: string): string {
  return `${tag}:${JSON.stringify(view.public)}:${JSON.stringify(view.self.secret)}:${view.legalMoves.length}`
}

/**
 * AI Phantom policy: evades known investigators (see `strategy.ts`'s
 * `phantomMove`). Sees only its own `PlayerView` — public state + its own
 * secret position — never another player's secret or the raw match state,
 * so it structurally cannot cheat.
 */
export const blackoutPhantomPolicy: BlackoutPolicy = (view, legalMoves) => {
  return phantomMove({ ...view, legalMoves }, cityGraph, seedFromView(view, 'phantom'))
}

/**
 * AI Investigator policy: pursues the phantom's last revealed node, falling
 * back to a seeded patrol before any reveal (see `strategy.ts`'s
 * `investigatorMove`).
 */
export const blackoutInvestigatorPolicy: BlackoutPolicy = (view, legalMoves) => {
  return investigatorMove({ ...view, legalMoves }, cityGraph, seedFromView(view, `investigator:${view.self.id}`))
}
