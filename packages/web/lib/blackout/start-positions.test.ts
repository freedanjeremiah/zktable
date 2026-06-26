import { describe, expect, it } from "vitest";
import { pickStartPositions } from "./start-positions";

describe("pickStartPositions", () => {
  const nodes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it("returns a phantom start and one distinct investigator start per investigator", () => {
    const rng = () => 0; // deterministic: always picks index 0 of the remaining pool
    const { phantom, investigators } = pickStartPositions(nodes, 3, rng);
    expect(nodes).toContain(phantom);
    expect(investigators).toHaveLength(3);
    for (const n of investigators) expect(nodes).toContain(n);
  });

  it("never repeats a node across phantom + investigators", () => {
    const rng = () => 0;
    const { phantom, investigators } = pickStartPositions(nodes, 5, rng);
    const all = [phantom, ...investigators];
    expect(new Set(all).size).toBe(all.length);
  });

  it("is deterministic for a fixed rng sequence", () => {
    let calls = 0;
    const sequence = [0.9, 0.1, 0.5, 0.3];
    const rng = () => sequence[calls++ % sequence.length]!;
    const a = pickStartPositions(nodes, 3, rng);
    calls = 0;
    const b = pickStartPositions(nodes, 3, rng);
    expect(a).toEqual(b);
  });

  it("throws if there are not enough distinct nodes for phantom + investigators", () => {
    const rng = () => 0;
    expect(() => pickStartPositions([1, 2], 3, rng)).toThrow(/not enough/i);
  });

  it("uses the full [0,1) range of rng to reach every node (no off-by-one)", () => {
    // rng() -> 0.999... should still select a valid in-range index, not overflow.
    const rng = () => 0.999999;
    const { phantom, investigators } = pickStartPositions(nodes, 2, rng);
    expect(nodes).toContain(phantom);
    for (const n of investigators) expect(nodes).toContain(n);
  });
});
