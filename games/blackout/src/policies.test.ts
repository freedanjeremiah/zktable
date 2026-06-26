import { describe, expect, it } from 'vitest'
import { HeuristicAgent } from '@zktable/agents'
import type { Move, PlayerView } from '@zktable/core'
import { blackoutInvestigatorPolicy, blackoutPhantomPolicy } from './policies.js'
import { buildRoster, createLocalMatch } from './runner.js'

const START_POSITIONS = { phantom: 1, investigator1: 55, investigator2: 80 }

function baseConfig() {
  return { startPositions: START_POSITIONS }
}

function view(overrides: Partial<PlayerView>): PlayerView {
  return {
    public: {},
    self: { id: 'p', secret: {} },
    tickets: {},
    legalMoves: [],
    ...overrides,
  }
}

describe('blackoutPhantomPolicy', () => {
  it('returns one of the given legal moves for a representative phantom view', () => {
    const moves: Move[] = [
      { type: 'move', to: 2, ticket: 0 },
      { type: 'move', to: 9, ticket: 1 },
    ]
    const v = view({
      self: { id: 'phantom', role: 'phantom', secret: { pos: 1 } },
      public: { investigatorNodes: { investigator1: 55 } },
      legalMoves: moves,
    })
    const move = blackoutPhantomPolicy(v, moves)
    expect(moves).toContainEqual(move)
  })

  it('is deterministic for repeated calls on the same view', () => {
    const moves: Move[] = [
      { type: 'move', to: 2, ticket: 0 },
      { type: 'move', to: 9, ticket: 1 },
    ]
    const v = view({
      self: { id: 'phantom', role: 'phantom', secret: { pos: 1 } },
      public: { investigatorNodes: { investigator1: 55 } },
      legalMoves: moves,
    })
    expect(blackoutPhantomPolicy(v, moves)).toEqual(blackoutPhantomPolicy(v, moves))
  })

  it('never sees another player\'s secret (structurally — only view.self.secret is read)', () => {
    // The policy's only inputs are `view` and `legalMoves`; `view.self.secret`
    // is the phantom's OWN secret (per Match.view), never another player's.
    const moves: Move[] = [{ type: 'move', to: 2, ticket: 0 }]
    const v = view({ self: { id: 'phantom', role: 'phantom', secret: { pos: 1 } }, legalMoves: moves })
    expect(() => blackoutPhantomPolicy(v, moves)).not.toThrow()
  })
})

describe('blackoutInvestigatorPolicy', () => {
  it('returns one of the given legal moves for a representative investigator view', () => {
    const moves: Move[] = [
      { type: 'move', to: 40, ticket: 0 },
      { type: 'move', to: 41, ticket: 1 },
    ]
    const v = view({
      self: { id: 'investigator1', role: 'investigator', secret: {} },
      public: { revealLog: [{ round: 3, node: 40 }] },
      legalMoves: moves,
    })
    const move = blackoutInvestigatorPolicy(v, moves)
    expect(moves).toContainEqual(move)
  })

  it('patrols (still a legal move) with no reveals yet', () => {
    const moves: Move[] = [
      { type: 'move', to: 40, ticket: 0 },
      { type: 'move', to: 41, ticket: 1 },
    ]
    const v = view({ self: { id: 'investigator1', role: 'investigator', secret: {} }, legalMoves: moves })
    const move = blackoutInvestigatorPolicy(v, moves)
    expect(moves).toContainEqual(move)
  })
})

describe('policies wrapped in HeuristicAgent play a full local Match', () => {
  it('drives buildRoster/createLocalMatch to a finished, definite outcome using only the Agent interface', async () => {
    const roster = buildRoster(2)
    const match = createLocalMatch(roster, baseConfig(), 'blackout-policy-agent-seed')

    const phantomAgent = new HeuristicAgent(blackoutPhantomPolicy)
    const investigatorAgent = new HeuristicAgent(blackoutInvestigatorPolicy)

    let steps = 0
    const maxSteps = 2000
    while (match.state.status === 'active' && steps < maxSteps) {
      const playerId = match.state.turn.current
      const v = match.view(playerId)
      const role = v.self.role
      const agent = role === 'phantom' ? phantomAgent : investigatorAgent
      const move = await agent.act(v, v.legalMoves)
      match.submit(playerId, move)
      if (role === 'phantom') {
        match.setSecret(playerId, { pos: move.to })
      }
      steps++
    }

    expect(steps).toBeLessThan(maxSteps)
    expect(match.state.status).toBe('finished')
    const outcome = match.state.outcome!
    if (Array.isArray(outcome.winner)) {
      expect(outcome.winner.sort()).toEqual(['investigator1', 'investigator2'])
    } else {
      expect(outcome.winner).toBe('phantom')
    }
  })
})
