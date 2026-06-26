import { describe, expect, it } from 'vitest'
import { deepEqual } from './deep-equal.js'

describe('deepEqual', () => {
  it('matches identical primitives', () => {
    expect(deepEqual('place', 'place')).toBe(true)
    expect(deepEqual(3, 3)).toBe(true)
    expect(deepEqual(3, 4)).toBe(false)
  })

  it('matches structurally identical objects regardless of key order', () => {
    expect(deepEqual({ type: 'place', cell: 4 }, { cell: 4, type: 'place' })).toBe(true)
  })

  it('rejects objects with differing values', () => {
    expect(deepEqual({ type: 'place', cell: 4 }, { type: 'place', cell: 5 })).toBe(false)
  })

  it('rejects objects with extra or missing keys', () => {
    expect(deepEqual({ type: 'place', cell: 4 }, { type: 'place' })).toBe(false)
    expect(deepEqual({ type: 'place' }, { type: 'place', cell: 4 })).toBe(false)
  })

  it('compares arrays element-wise and by length', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
  })

  it('handles nested structures', () => {
    expect(
      deepEqual({ type: 'x', payload: { a: [1, { b: 2 }] } }, { payload: { a: [1, { b: 2 }] }, type: 'x' }),
    ).toBe(true)
  })

  it('handles null correctly', () => {
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual(null, {})).toBe(false)
  })
})
