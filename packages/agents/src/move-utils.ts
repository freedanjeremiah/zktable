import type { Move } from '@zktable/core'

/**
 * Structural deep equality, independent of object key order. Mirrors
 * `@zktable/core`'s internal `deepEqual` (not exported from the package),
 * so agent-side legality checks agree with what `Match.submit` will accept.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true

  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }

  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false

  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  )
}

/**
 * Throws unless `move` is structurally equal to one of `legalMoves`. Every
 * agent in this package calls this before returning from `act`, so a
 * misbehaving policy (or a malformed model response) fails fast at the
 * agent boundary rather than reaching `Match.submit`.
 */
export function assertLegalMove(move: Move, legalMoves: Move[]): void {
  if (!legalMoves.some((candidate) => deepEqual(candidate, move))) {
    throw new Error(
      `Agent chose an illegal move ${JSON.stringify(move)}; legal moves were ${JSON.stringify(legalMoves)}`,
    )
  }
}
