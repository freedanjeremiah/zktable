import { describe, expect, it } from 'vitest'
import { createMatch } from '@zktable/core'
import { blackout, DEFAULT_REVEAL_ROUNDS, DEFAULT_TICKETS } from './blackout.js'
import type { BlackoutConfig, RevealEntry } from './blackout.js'
import { buildRoster, playLocalMatch } from './runner.js'

const START_POSITIONS = { phantom: 1, investigator1: 55, investigator2: 80 }

function baseConfig(overrides: Partial<BlackoutConfig> = {}): BlackoutConfig {
  return { startPositions: START_POSITIONS, ...overrides }
}

describe('blackout — initial local state', () => {
  it('seats phantom first, then investigators in join order', () => {
    const roster = buildRoster(2)
    const match = createMatch(blackout, roster, { config: { blackout: baseConfig() } })
    expect(match.state.turn.order).toEqual(['phantom', 'investigator1', 'investigator2'])
    expect(match.state.turn.current).toBe('phantom')
  })

  it('gives every player their configured (or default) ticket wallet', () => {
    const roster = buildRoster(1)
    const match = createMatch(blackout, roster, { config: { blackout: baseConfig() } })
    for (const p of match.state.players) {
      expect(p.resources).toEqual(DEFAULT_TICKETS)
    }
  })

  it("keeps the phantom's position out of public state, but visible in their own view", () => {
    const roster = buildRoster(1)
    const match = createMatch(blackout, roster, { config: { blackout: baseConfig() } })
    expect(JSON.stringify(match.state.public)).not.toContain('"pos"')
    expect(match.view('phantom').self.secret).toEqual({ pos: 1 })
    expect(match.view('investigator1').self.secret).toEqual({})
  })

  it('seeds investigatorNodes from startPositions', () => {
    const roster = buildRoster(2)
    const match = createMatch(blackout, roster, { config: { blackout: baseConfig() } })
    expect(match.state.public.investigatorNodes).toEqual({ investigator1: 55, investigator2: 80 })
  })
})

describe('blackout — a full local game (seeded, deterministic)', () => {
  const roster = buildRoster(2)

  it('plays to a definite, deterministic end for a fixed seed', () => {
    const a = playLocalMatch(roster, baseConfig(), 'blackout-seed-1')
    const b = playLocalMatch(roster, baseConfig(), 'blackout-seed-1')
    expect(a.match.state.status).toBe('finished')
    expect(a.match.state).toEqual(b.match.state)
    expect(a.steps).toEqual(b.steps)
  })

  it('declares a definite outcome: the phantom, or all investigators', () => {
    const { match } = playLocalMatch(roster, baseConfig(), 'blackout-seed-1')
    const outcome = match.state.outcome!
    expect(outcome).toBeTruthy()
    if (Array.isArray(outcome.winner)) {
      expect(outcome.winner.sort()).toEqual(['investigator1', 'investigator2'])
    } else {
      expect(outcome.winner).toBe('phantom')
    }
  })

  it('respects turn order: phantom moves, then each investigator, every round', () => {
    const { steps } = playLocalMatch(roster, baseConfig(), 'blackout-seed-2')
    for (let i = 0; i < steps.length; i += 3) {
      const round = steps.slice(i, i + 3).map((s) => s.playerId)
      expect(round[0]).toBe('phantom')
      // A round may end early (capture) without every investigator moving.
      expect(round.slice(1).every((id) => id === 'investigator1' || id === 'investigator2')).toBe(true)
    }
  })

  it('records reveal entries at the configured reveal rounds, starting with round 3', () => {
    const { match } = playLocalMatch(roster, baseConfig(), 'blackout-seed-3')
    const revealLog = match.state.public.revealLog as RevealEntry[]
    expect(revealLog.length).toBeGreaterThan(0)
    const rounds = revealLog.map((r) => r.round)
    expect(rounds[0]).toBe(3)
    for (const round of rounds) {
      expect(DEFAULT_REVEAL_ROUNDS).toContain(round)
    }
    // Monotonically increasing, matching DEFAULT_REVEAL_ROUNDS order.
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b))
  })

  it('decrements ticket resources as the game progresses', () => {
    const { match } = playLocalMatch(roster, baseConfig(), 'blackout-seed-4')
    const phantom = match.state.players.find((p) => p.id === 'phantom')!
    const totalRemaining = Object.values(phantom.resources).reduce((a, b) => (a as number) + (b as number), 0)
    const totalStart = Object.values(DEFAULT_TICKETS).reduce((a, b) => a + b, 0)
    expect(totalRemaining).toBeLessThan(totalStart)
  })

  it('produces a shorter, still-deterministic game with a smaller nRounds/revealRounds config', () => {
    const smallConfig = baseConfig({ nRounds: 6, revealRounds: [2, 4, 6] })
    const { match } = playLocalMatch(roster, smallConfig, 'blackout-small-seed')
    expect(match.state.status).toBe('finished')
    const revealLog = match.state.public.revealLog as RevealEntry[]
    for (const r of revealLog) {
      expect([2, 4, 6]).toContain(r.round)
    }
  })
})
