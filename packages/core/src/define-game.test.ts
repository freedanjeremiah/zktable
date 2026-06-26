import { describe, expect, it } from 'vitest'
import { defineGame } from './define-game.js'
import type { GameDefinition } from './types.js'

function baseDef(overrides: Partial<GameDefinition> = {}): GameDefinition {
  return {
    name: 'test-game',
    players: { min: 2, max: 2 },
    state: {
      public: () => ({}),
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
    ...overrides,
  }
}

describe('defineGame', () => {
  it('returns a compiled Game wrapping the definition', () => {
    const def = baseDef()
    const game = defineGame(def)
    expect(game.def).toBe(def)
  })

  it('throws when name is empty', () => {
    expect(() => defineGame(baseDef({ name: '' }))).toThrow(/name/i)
  })

  it('throws when name is only whitespace', () => {
    expect(() => defineGame(baseDef({ name: '   ' }))).toThrow(/name/i)
  })

  it('throws when players.min is less than 1', () => {
    expect(() => defineGame(baseDef({ players: { min: 0, max: 2 } }))).toThrow(/players/i)
  })

  it('throws when players.max is less than players.min', () => {
    expect(() => defineGame(baseDef({ players: { min: 4, max: 2 } }))).toThrow(/players/i)
  })

  it("throws when turn.order is 'roles' but no roles are declared", () => {
    expect(() =>
      defineGame(
        baseDef({
          players: { min: 2, max: 2 },
          turn: { order: 'roles', moves: baseDef().turn.moves },
        }),
      ),
    ).toThrow(/role/i)
  })

  it('throws when a move is missing legal()', () => {
    expect(() =>
      defineGame(
        baseDef({
          turn: {
            order: 'clockwise',
            moves: {
              // @ts-expect-error deliberately malformed for the test
              broken: { apply: (state) => state },
            },
          },
        }),
      ),
    ).toThrow(/legal/i)
  })

  it('throws when a move is missing apply()', () => {
    expect(() =>
      defineGame(
        baseDef({
          turn: {
            order: 'clockwise',
            moves: {
              // @ts-expect-error deliberately malformed for the test
              broken: { legal: () => [] },
            },
          },
        }),
      ),
    ).toThrow(/apply/i)
  })

  it('throws when turn.moves is empty', () => {
    expect(() =>
      defineGame(
        baseDef({
          turn: { order: 'clockwise', moves: {} },
        }),
      ),
    ).toThrow(/move/i)
  })

  it('throws when state.public is missing', () => {
    expect(() =>
      defineGame(
        baseDef({
          // @ts-expect-error deliberately malformed for the test
          state: {},
        }),
      ),
    ).toThrow(/public/i)
  })

  it('accepts a valid definition with roles', () => {
    const def = baseDef({
      players: { min: 2, max: 2, roles: ['a', 'b'] },
      turn: { order: 'roles', moves: baseDef().turn.moves },
    })
    expect(() => defineGame(def)).not.toThrow()
  })
})
