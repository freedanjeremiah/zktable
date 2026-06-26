import type { Move, PlayerView } from '@zktable/core'
import { createRng, randomIndex } from './rng.js'
import { assertLegalMove } from './move-utils.js'
import type { Agent, GameEvent } from './types.js'

/** A pure function from (view, legalMoves) -> the move to play. Must not mutate its inputs. */
export type Policy = (view: PlayerView, legalMoves: Move[]) => Move

/**
 * Baseline `Agent` driven by a pure `policy` function. Deterministic: the
 * same `(view, legalMoves)` input always produces the same move, and (for
 * policies that use the optional `seed`, e.g. `RandomAgent`) the same seed
 * always produces the same sequence of moves across a whole match.
 *
 * `act` never trusts the policy blindly — it asserts the returned move is
 * one of `legalMoves` and throws otherwise, so a buggy policy fails loudly
 * instead of silently reaching `Match.submit` with an illegal move.
 */
export class HeuristicAgent implements Agent {
  protected readonly policy: Policy
  protected readonly seed: string | undefined

  constructor(policy: Policy, seed?: string) {
    this.policy = policy
    this.seed = seed
  }

  async act(view: PlayerView, legalMoves: Move[]): Promise<Move> {
    const move = this.policy(view, legalMoves)
    assertLegalMove(move, legalMoves)
    return move
  }

  observe(_event: GameEvent): void {
    // No-op by default; subclasses/instances may override.
  }
}

/**
 * Picks uniformly at random among `legalMoves` using a seeded PRNG (never
 * `Math.random`) — useful as a CI/test baseline opponent and as a sanity
 * check that the harness never lets an agent choose outside `legalMoves`.
 */
export class RandomAgent extends HeuristicAgent {
  constructor(seed = 'zktable-random-agent') {
    const rng = createRng(seed)
    super((_view, legalMoves) => {
      if (legalMoves.length === 0) {
        throw new Error('RandomAgent.act: no legal moves to choose from')
      }
      const index = randomIndex(rng, legalMoves.length)
      return legalMoves[index]!
    }, seed)
  }
}
