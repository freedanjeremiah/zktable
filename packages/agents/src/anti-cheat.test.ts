import { createMatch, defineGame, type MatchState, type Move, type PlayerView } from '@zktable/core'
import { describe, expect, it } from 'vitest'
import { HeuristicAgent } from './heuristic-agent.js'
import type { Agent } from './types.js'

// THE HEADLINE PROPERTY: an AI agent sees only a `PlayerView` — public state
// plus its OWN secret — and moves through the exact same proof path as a
// human. This test proves the harness cannot leak another player's secret
// into an agent's `act` input, for a game that actually HAS per-player
// secrets (ticTacToe, used elsewhere in this package's tests, is fully
// public and so wouldn't exercise this).

type Secret = { hiddenNumber: number }

/**
 * A minimal 2-player game where each player holds a private `hiddenNumber`
 * that the other player must never see. The only move type just passes the
 * turn, so we can drive a couple of turns and inspect both seats' views.
 */
const secretNumberGame = defineGame({
  name: 'secret-number-test-game',
  players: { min: 2, max: 2 },
  state: {
    public: () => ({ passes: 0 }),
    secret: (ctx) => ({ hiddenNumber: ctx.id === 'p1' ? 1111 : 2222 }) satisfies Secret,
  },
  turn: {
    order: 'clockwise',
    moves: {
      pass: {
        legal: (): Move[] => [{ type: 'pass' }],
        apply: (state: MatchState): MatchState => ({
          ...state,
          public: { ...state.public, passes: ((state.public.passes as number) ?? 0) + 1 },
        }),
      },
    },
  },
  end: (state: MatchState) => ((state.public.passes as number) >= 4 ? { winner: 'draw' } : null),
})

/** Wraps a HeuristicAgent and records every `view` it was ever asked to `act` on. */
class RecordingAgent implements Agent {
  readonly seenViews: PlayerView[] = []
  private readonly inner: HeuristicAgent

  constructor() {
    this.inner = new HeuristicAgent((_view, legalMoves) => legalMoves[0]!)
  }

  async act(view: PlayerView, legalMoves: Move[]): Promise<Move> {
    this.seenViews.push(view)
    return this.inner.act(view, legalMoves)
  }
}

describe('anti-cheat invariant', () => {
  it("an agent's act() input never contains the other player's secret", async () => {
    const match = createMatch(secretNumberGame, [{ id: 'p1' }, { id: 'p2' }])
    const agentP1 = new RecordingAgent()
    const agentP2 = new RecordingAgent()

    let guard = 0
    while (match.state.status !== 'finished') {
      if (++guard > 20) throw new Error('runaway game loop')
      const current = match.state.turn.current
      const agent = current === 'p1' ? agentP1 : agentP2
      const view = match.view(current)
      const move = await agent.act(view, view.legalMoves)
      match.submit(current, move)
    }

    expect(match.state.status).toBe('finished')
    expect(agentP1.seenViews.length).toBeGreaterThan(0)
    expect(agentP2.seenViews.length).toBeGreaterThan(0)

    // p1 only ever saw its own secret (1111), never p2's (2222) — and vice versa.
    for (const view of agentP1.seenViews) {
      expect(view.self.id).toBe('p1')
      expect((view.self.secret as Secret).hiddenNumber).toBe(1111)
      // Belt-and-suspenders: the number 2222 must not appear ANYWHERE in the
      // serialized view, under any key.
      expect(JSON.stringify(view)).not.toContain('2222')
    }
    for (const view of agentP2.seenViews) {
      expect(view.self.id).toBe('p2')
      expect((view.self.secret as Secret).hiddenNumber).toBe(2222)
      expect(JSON.stringify(view)).not.toContain('1111')
    }

    // Structural check: `PlayerView.self` only ever describes the acting
    // player — there is no field anywhere that could carry another
    // player's secret (no `players`, `secrets`, `opponents`, etc.).
    for (const view of [...agentP1.seenViews, ...agentP2.seenViews]) {
      expect(Object.keys(view).sort()).toEqual(['legalMoves', 'public', 'self', 'tickets'].sort())
      expect(Object.keys(view.self).sort()).toEqual(['id', 'role', 'secret'].sort())
    }
  })

  it('ClaudeAgent-shaped consumers get the same restricted view (no other-player secret in the prompt payload)', async () => {
    // Even for an agent implementation that serializes the WHOLE view into
    // a prompt (as ClaudeAgent does), there is nothing to leak — because
    // Match.view() never put the other player's secret there in the first
    // place. This test documents that guarantee at the call-site agents
    // actually use.
    const match = createMatch(secretNumberGame, [{ id: 'p1' }, { id: 'p2' }])
    const view = match.view('p1')
    const serialized = JSON.stringify(view)

    expect(serialized).toContain('1111')
    expect(serialized).not.toContain('2222')
  })
})
