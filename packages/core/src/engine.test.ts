import { describe, expect, it } from 'vitest'
import { createMatch } from './engine.js'
import { defineGame } from './define-game.js'
import type { MatchState } from './types.js'

// --- fixture games -----------------------------------------------------

/** Two players, no roles, a single `pass` move that bumps a public counter. */
function counterGame() {
  return defineGame({
    name: 'counter',
    players: { min: 2, max: 2 },
    state: {
      public: () => ({ count: 0 }),
    },
    turn: {
      order: 'clockwise',
      moves: {
        pass: {
          legal: () => [{ type: 'pass' }],
          apply: (state) => ({
            ...state,
            public: { ...state.public, count: (state.public.count as number) + 1 },
          }),
        },
      },
    },
    end: () => null,
  })
}

/** Two roled players; move order derives from `players.roles`. */
function roledGame() {
  return defineGame({
    name: 'roled',
    players: { min: 2, max: 2, roles: ['hunter', 'prey'] },
    state: {
      public: () => ({}),
    },
    turn: {
      order: 'roles',
      moves: {
        pass: {
          legal: () => [{ type: 'pass' }],
          apply: (state) => state,
        },
      },
    },
    end: () => null,
  })
}

/** Two players, each with a private `secret.code`; never leaked to the other player's view. */
function secretGame() {
  return defineGame({
    name: 'secret-game',
    players: { min: 2, max: 2 },
    state: {
      public: () => ({}),
      secret: ({ id }) => ({ code: `code-for-${id}` }),
    },
    turn: {
      order: 'clockwise',
      moves: {
        pass: {
          legal: () => [{ type: 'pass' }],
          apply: (state) => state,
        },
      },
    },
    end: () => null,
  })
}

/** Two players; a move with two legal options, and a second move only legal on round >= 1. */
function branchingGame() {
  return defineGame({
    name: 'branching',
    players: { min: 2, max: 2 },
    state: {
      public: () => ({ log: [] as string[] }),
    },
    turn: {
      order: 'clockwise',
      moves: {
        step: {
          legal: () => [{ type: 'step', dir: 'left' }, { type: 'step', dir: 'right' }],
          apply: (state, move) => ({
            ...state,
            public: { ...state.public, log: [...(state.public.log as string[]), String(move.dir)] },
          }),
        },
      },
    },
    end: () => null,
  })
}

/** Ends immediately after the first move, declaring player "p1" the winner. */
function endsFastGame() {
  return defineGame({
    name: 'ends-fast',
    players: { min: 2, max: 2 },
    state: {
      public: () => ({ moved: false }),
    },
    turn: {
      order: 'clockwise',
      moves: {
        pass: {
          legal: () => [{ type: 'pass' }],
          apply: (state) => ({ ...state, public: { ...state.public, moved: true } }),
        },
      },
    },
    end: (state) => (state.public.moved ? { winner: 'p1' } : null),
  })
}

/** Reveal checkpoint fires once `public.count` reaches 2. */
function revealGame() {
  return defineGame({
    name: 'reveal-game',
    players: { min: 2, max: 2 },
    state: {
      public: () => ({ count: 0 }),
      secret: ({ id }) => ({ position: `pos-${id}` }),
    },
    turn: {
      order: 'clockwise',
      moves: {
        pass: {
          legal: () => [{ type: 'pass' }],
          apply: (state) => ({
            ...state,
            public: { ...state.public, count: (state.public.count as number) + 1 },
          }),
        },
      },
    },
    reveal: {
      when: (state) => (state.public.count as number) >= 2,
      what: ['position'],
    },
    end: () => null,
  })
}

const roster2 = [{ id: 'p1' }, { id: 'p2' }]

// --- createMatch: roster validation ------------------------------------

describe('createMatch — roster validation', () => {
  it('throws when roster is smaller than players.min', () => {
    const game = counterGame()
    expect(() => createMatch(game, [{ id: 'p1' }])).toThrow(/player/i)
  })

  it('throws when roster is larger than players.max', () => {
    const game = counterGame()
    expect(() =>
      createMatch(game, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]),
    ).toThrow(/player/i)
  })

  it('throws when a required role is missing from a roster entry', () => {
    const game = roledGame()
    expect(() =>
      createMatch(game, [{ id: 'p1', role: 'hunter' }, { id: 'p2' }]),
    ).toThrow(/role/i)
  })

  it('throws when a roster entry has a role outside the declared set', () => {
    const game = roledGame()
    expect(() =>
      createMatch(game, [
        { id: 'p1', role: 'hunter' },
        { id: 'p2', role: 'bystander' },
      ]),
    ).toThrow(/role/i)
  })

  it('accepts a valid roster', () => {
    const game = counterGame()
    expect(() => createMatch(game, roster2)).not.toThrow()
  })
})

// --- initial state -------------------------------------------------------

describe('createMatch — initial state', () => {
  it('builds an active match with public state, empty commitments, and null outcome', () => {
    const match = createMatch(counterGame(), roster2)
    expect(match.state.status).toBe('active')
    expect(match.state.public).toEqual({ count: 0 })
    expect(match.state.commitments).toEqual({})
    expect(match.state.outcome).toBeNull()
  })

  it('gives every player zero resources by default', () => {
    const match = createMatch(counterGame(), roster2)
    for (const p of match.state.players) {
      expect(p.resources).toEqual({})
    }
  })

  it('runs the optional setup hook after building initial state', () => {
    const game = defineGame({
      name: 'with-setup',
      players: { min: 2, max: 2 },
      state: { public: () => ({ ready: false }) },
      setup: (state) => ({ ...state, public: { ...state.public, ready: true } }),
      turn: {
        order: 'clockwise',
        moves: { pass: { legal: () => [{ type: 'pass' }], apply: (s) => s } },
      },
      end: () => null,
    })
    const match = createMatch(game, roster2)
    expect(match.state.public.ready).toBe(true)
  })
})

// --- turn order ------------------------------------------------------------

describe('turn order resolution', () => {
  it("'clockwise' follows roster seat order, cycling", () => {
    const match = createMatch(counterGame(), roster2)
    expect(match.state.turn.order).toEqual(['p1', 'p2'])
    expect(match.state.turn.current).toBe('p1')
  })

  it("'roles' orders players by the declared roles array", () => {
    const match = createMatch(roledGame(), [
      { id: 'p2', role: 'prey' },
      { id: 'p1', role: 'hunter' },
    ])
    expect(match.state.turn.order).toEqual(['p1', 'p2'])
    expect(match.state.turn.current).toBe('p1')
  })

  it('accepts a custom order function', () => {
    const game = defineGame({
      name: 'custom-order',
      players: { min: 2, max: 2 },
      state: { public: () => ({}) },
      turn: {
        order: (players) => players.map((p) => p.id).reverse(),
        moves: { pass: { legal: () => [{ type: 'pass' }], apply: (s) => s } },
      },
      end: () => null,
    })
    const match = createMatch(game, roster2)
    expect(match.state.turn.order).toEqual(['p2', 'p1'])
    expect(match.state.turn.current).toBe('p2')
  })
})

// --- view() ------------------------------------------------------------

describe('match.view', () => {
  it('throws for an unknown playerId', () => {
    const match = createMatch(counterGame(), roster2)
    expect(() => match.view('ghost')).toThrow(/unknown player/i)
  })

  it("returns each player's own secret only", () => {
    const match = createMatch(secretGame(), roster2)
    const viewA = match.view('p1')
    const viewB = match.view('p2')
    expect(viewA.self.secret).toEqual({ code: 'code-for-p1' })
    expect(viewB.self.secret).toEqual({ code: 'code-for-p2' })
    expect(JSON.stringify(viewA)).not.toContain('code-for-p2')
    expect(JSON.stringify(viewB)).not.toContain('code-for-p1')
  })

  it('includes shared public state for every player', () => {
    const match = createMatch(counterGame(), roster2)
    expect(match.view('p1').public).toEqual({ count: 0 })
    expect(match.view('p2').public).toEqual({ count: 0 })
  })

  it("legalMoves is populated only for the player whose turn it is", () => {
    const match = createMatch(counterGame(), roster2) // p1 goes first
    expect(match.view('p1').legalMoves).toEqual([{ type: 'pass' }])
    expect(match.view('p2').legalMoves).toEqual([])
  })
})

// --- legalMoves() --------------------------------------------------------

describe('match.legalMoves', () => {
  it('matches view(playerId).legalMoves', () => {
    const match = createMatch(branchingGame(), roster2)
    expect(match.legalMoves('p1')).toEqual(match.view('p1').legalMoves)
    expect(match.legalMoves('p1')).toEqual([
      { type: 'step', dir: 'left' },
      { type: 'step', dir: 'right' },
    ])
  })

  it('is empty for a player when it is not their turn', () => {
    const match = createMatch(branchingGame(), roster2)
    expect(match.legalMoves('p2')).toEqual([])
  })
})

// --- submit() ------------------------------------------------------------

describe('match.submit', () => {
  it('throws when it is not the submitting player\'s turn', () => {
    const match = createMatch(counterGame(), roster2)
    expect(() => match.submit('p2', { type: 'pass' })).toThrow(/turn/i)
  })

  it('throws when the move is not among the legal moves', () => {
    const match = createMatch(counterGame(), roster2)
    expect(() => match.submit('p1', { type: 'bogus' })).toThrow(/legal/i)
  })

  it('applies the matching move spec and mutates public state accordingly', () => {
    const match = createMatch(counterGame(), roster2)
    match.submit('p1', { type: 'pass' })
    expect(match.state.public.count).toBe(1)
  })

  it('advances turn to the next player in order', () => {
    const match = createMatch(counterGame(), roster2)
    match.submit('p1', { type: 'pass' })
    expect(match.state.turn.current).toBe('p2')
  })

  it('increments round when the order wraps back to the first seat', () => {
    const match = createMatch(counterGame(), roster2)
    expect(match.state.turn.round).toBe(0)
    match.submit('p1', { type: 'pass' })
    expect(match.state.turn.round).toBe(0)
    match.submit('p2', { type: 'pass' })
    expect(match.state.turn.round).toBe(1)
    expect(match.state.turn.current).toBe('p1')
  })

  it('matches a move by deep equality, independent of key order', () => {
    const match = createMatch(branchingGame(), roster2)
    match.submit('p1', { dir: 'left', type: 'step' })
    expect(match.state.public.log).toEqual(['left'])
  })

  it('sets status to finished and records the outcome once end() returns non-null', () => {
    const match = createMatch(endsFastGame(), roster2)
    match.submit('p1', { type: 'pass' })
    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).toEqual({ winner: 'p1' })
  })

  it('throws when submitting to a finished match', () => {
    const match = createMatch(endsFastGame(), roster2)
    match.submit('p1', { type: 'pass' })
    expect(() => match.submit('p2', { type: 'pass' })).toThrow(/finished/i)
  })

  it('throws for an unknown playerId', () => {
    const match = createMatch(counterGame(), roster2)
    expect(() => match.submit('ghost', { type: 'pass' })).toThrow(/unknown player/i)
  })
})

// --- reveal checkpoint seam ------------------------------------------------

describe('reveal checkpoints', () => {
  it('marks a reveal checkpoint in public state once reveal.when(state) is true', () => {
    const match = createMatch(revealGame(), roster2)
    match.submit('p1', { type: 'pass' }) // count -> 1, not yet
    expect(match.state.public.reveals).toBeUndefined()
    match.submit('p2', { type: 'pass' }) // count -> 2, triggers
    // Reveal checkpoints are evaluated against the post-`apply`, pre-turn-advance
    // state (per the engine's documented submit() order), so `round` here is
    // still the round the triggering move was played in.
    expect(match.state.public.reveals).toEqual([{ round: 0, what: ['position'] }])
  })
})

// --- setSecret() ---------------------------------------------------------

describe('match.setSecret', () => {
  it('replaces the given player\'s stored secret, leaving other players untouched', () => {
    const match = createMatch(secretGame(), roster2)
    match.setSecret('p1', { code: 'new-code-for-p1' })
    expect(match.view('p1').self.secret).toEqual({ code: 'new-code-for-p1' })
    expect(match.view('p2').self.secret).toEqual({ code: 'code-for-p2' })
  })

  it('is visible on the next view() even mid-match, without affecting public state', () => {
    const match = createMatch(secretGame(), roster2)
    const publicBefore = match.state.public
    match.setSecret('p2', { code: 'updated' })
    expect(match.view('p2').self.secret).toEqual({ code: 'updated' })
    expect(match.state.public).toBe(publicBefore)
  })

  it('throws for an unknown playerId', () => {
    const match = createMatch(secretGame(), roster2)
    expect(() => match.setSecret('ghost', { code: 'x' })).toThrow(/unknown player/i)
  })
})

// --- determinism -----------------------------------------------------------

describe('determinism', () => {
  it('same seed + same moves produce identical final MatchState', () => {
    const moves = [{ type: 'pass' }, { type: 'pass' }, { type: 'pass' }, { type: 'pass' }]
    const players: PlayerId[] = ['p1', 'p2']

    function run(): MatchState {
      const match = createMatch(counterGame(), roster2, { seed: 'fixed-seed' })
      for (let i = 0; i < moves.length; i++) {
        const move = moves[i]!
        const current = players[i % players.length]!
        match.submit(current, move)
      }
      return match.state
    }

    const a = run()
    const b = run()
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

type PlayerId = string

// --- turn.eliminated: skip hook -----------------------------------------

/**
 * N-player elimination fixture: `zap` knocks a target out (recorded in the
 * game's OWN public state — the engine holds no elimination state), `pass`
 * does nothing. `endWhenOneLeft` controls whether end() declares the last
 * active seat the winner (normal) or never ends (used to prove the engine
 * throws instead of spinning).
 */
function eliminationGame(endWhenOneLeft: boolean) {
  const activeIds = (state: { public: Record<string, unknown> }) => {
    const eliminated = state.public.eliminated as string[]
    return (state.public.roster as string[]).filter((id) => !eliminated.includes(id))
  }
  return defineGame({
    name: 'elimination',
    players: { min: 2, max: 6 },
    state: {
      public: (ctx) => ({ eliminated: [] as string[], roster: ctx.players.map((p) => p.id) }),
    },
    turn: {
      order: 'clockwise',
      eliminated: (state, id) => (state.public.eliminated as string[]).includes(id),
      moves: {
        zap: {
          legal: (view) => {
            const eliminated = view.public.eliminated as string[]
            return (view.public.roster as string[])
              .filter((id) => id !== view.self.id && !eliminated.includes(id))
              .map((target) => ({ type: 'zap', target }))
          },
          apply: (state, move) => ({
            ...state,
            public: {
              ...state.public,
              eliminated: [...(state.public.eliminated as string[]), move.target as string],
            },
          }),
        },
        pass: {
          legal: () => [{ type: 'pass' }],
          apply: (state) => state,
        },
      },
    },
    end: (state) => {
      if (!endWhenOneLeft) return null
      const active = activeIds(state)
      return active.length === 1 ? { winner: active[0]! } : null
    },
  })
}

const roster4 = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }]

describe('turn.eliminated — skipping eliminated seats', () => {
  it('skips an eliminated seat when advancing the turn', () => {
    const match = createMatch(eliminationGame(true), roster4)
    match.submit('p1', { type: 'zap', target: 'p2' })
    expect(match.state.turn.current).toBe('p3')
  })

  it('skips consecutive eliminated seats', () => {
    const match = createMatch(eliminationGame(true), roster4)
    match.submit('p1', { type: 'zap', target: 'p2' })
    match.submit('p3', { type: 'zap', target: 'p4' })
    // p4 (eliminated) and the wrap back to p1: p3 -> p1 directly.
    expect(match.state.turn.current).toBe('p1')
  })

  it('still increments round when the wrap crosses skipped seats', () => {
    const match = createMatch(eliminationGame(true), roster4)
    match.submit('p1', { type: 'zap', target: 'p4' })
    match.submit('p2', { type: 'pass' })
    expect(match.state.turn.round).toBe(0)
    // p3 -> (p4 skipped, wrap crosses top of order) -> p1: round increments.
    match.submit('p3', { type: 'pass' })
    expect(match.state.turn.current).toBe('p1')
    expect(match.state.turn.round).toBe(1)
  })

  it('returns no legal moves for an eliminated player', () => {
    const match = createMatch(eliminationGame(true), roster4)
    match.submit('p1', { type: 'zap', target: 'p2' })
    expect(match.legalMoves('p2')).toEqual([])
  })

  it('declares the winner (via end()) when the field drops to one', () => {
    const match = createMatch(eliminationGame(true), [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }])
    match.submit('p1', { type: 'zap', target: 'p2' })
    match.submit('p3', { type: 'zap', target: 'p1' })
    expect(match.state.status).toBe('finished')
    expect(match.state.outcome).toEqual({ winner: 'p3' })
  })

  it('throws when all but one player are eliminated and end() returns null', () => {
    const match = createMatch(eliminationGame(false), [{ id: 'p1' }, { id: 'p2' }])
    expect(() => match.submit('p1', { type: 'zap', target: 'p2' })).toThrow(/end\(\) returned null/)
  })
})

describe('defineGame — turn.eliminated validation', () => {
  it('rejects a non-function turn.eliminated', () => {
    expect(() =>
      defineGame({
        name: 'bad',
        players: { min: 2, max: 2 },
        state: { public: () => ({}) },
        turn: {
          order: 'clockwise',
          eliminated: 'nope' as unknown as (s: never, p: never) => boolean,
          moves: { pass: { legal: () => [{ type: 'pass' }], apply: (s) => s } },
        },
        end: () => null,
      }),
    ).toThrow(/turn\.eliminated/)
  })
})
