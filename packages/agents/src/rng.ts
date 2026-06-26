// Deterministic, dependency-free seeded PRNG. Agents must be reproducible
// given the same seed (same seed -> same move sequence), so nothing in this
// package may call `Math.random()`.

export type Rng = () => number

/** FNV-1a string hash -> 32-bit unsigned int, used to derive a PRNG seed from a string. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * mulberry32: a small, fast, deterministic PRNG. Returns a function that
 * yields floats in [0, 1), same sequence every time for the same seed.
 */
export function createRng(seed: string): Rng {
  let state = hashSeed(seed)
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Pick a uniformly random index in `[0, length)` using `rng`. */
export function randomIndex(rng: Rng, length: number): number {
  return Math.floor(rng() * length)
}
