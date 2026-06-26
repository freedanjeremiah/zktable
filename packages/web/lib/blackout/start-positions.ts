// Pure logic for picking distinct starting nodes for a fresh Blackout match:
// one random node for the Phantom's hidden start, and N more (still random,
// but never colliding with the Phantom's or each other's) for the
// Investigators' public starts. Kept separate from the (I/O-heavy)
// orchestrator so it's trivially unit-testable with an injected `rng`.

export type StartPositions = { phantom: number; investigators: number[] };

/**
 * Picks `1 + investigatorCount` distinct nodes out of `nodes` using
 * Fisher-Yates partial shuffle driven by `rng` (a `() => number` in `[0,1)`,
 * e.g. `Math.random` in production — injected here so tests are
 * deterministic without touching global randomness).
 */
export function pickStartPositions(
  nodes: readonly number[],
  investigatorCount: number,
  rng: () => number = Math.random,
): StartPositions {
  const needed = 1 + investigatorCount;
  if (nodes.length < needed) {
    throw new Error(
      `pickStartPositions: not enough distinct nodes (have ${nodes.length}, need ${needed} for 1 phantom + ${investigatorCount} investigator(s))`,
    );
  }

  const pool = [...nodes];
  const picked: number[] = [];
  for (let i = 0; i < needed; i++) {
    const remaining = pool.length - i;
    const index = i + Math.min(remaining - 1, Math.floor(rng() * remaining));
    // Swap the chosen node into the "already picked" prefix.
    const tmp = pool[i]!;
    pool[i] = pool[index]!;
    pool[index] = tmp;
    picked.push(pool[i]!);
  }

  const [phantom, ...investigators] = picked;
  return { phantom: phantom!, investigators };
}
