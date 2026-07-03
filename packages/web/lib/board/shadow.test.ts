import { describe, expect, it } from "vitest";
import { computeShadow, extractPhantomTickets } from "./shadow";
import type { GraphLike } from "./shadow";

// A small synthetic 4-node graph — deliberately NOT the real 100-node city,
// so the expected candidate sets are hand-checkable.
//
//   1 --taxi-- 2 --bus-- 3 --rail-- 4
//   1 ------------taxi------------ 4
//
const GRAPH: GraphLike = {
  nodes: [1, 2, 3, 4],
  edges: [
    { from: 1, to: 2, ticket: 0 }, // taxi
    { from: 2, to: 3, ticket: 1 }, // bus
    { from: 3, to: 4, ticket: 2 }, // rail
    { from: 1, to: 4, ticket: 0 }, // taxi
  ],
  bidirectional: true,
};

describe("extractPhantomTickets", () => {
  it("picks the Phantom's own entries out of the mixed on-chain ticket feed", () => {
    // Turn order is phantom, then investigators (join order), repeating —
    // see games/blackout/src/blackout.ts `order: 'roles'`. With 2
    // investigators the cycle length is 3: [phantom, inv1, inv2].
    const ticketFeed = [0, 1, 1, 2, 0, 0]; // round1: p=0,i=1,i=1 ; round2: p=2,i=0,i=0
    expect(extractPhantomTickets(ticketFeed, 2)).toEqual([
      { round: 1, ticket: 0 },
      { round: 2, ticket: 2 },
    ]);
  });

  it("handles a mid-cycle feed (Phantom moved this round, investigators haven't yet)", () => {
    const ticketFeed = [0, 1, 1, 2]; // round2's phantom entry present, investigators pending
    expect(extractPhantomTickets(ticketFeed, 2)).toEqual([
      { round: 1, ticket: 0 },
      { round: 2, ticket: 2 },
    ]);
  });

  it("returns an empty list before the Phantom has moved", () => {
    expect(extractPhantomTickets([], 2)).toEqual([]);
  });

  it("degenerates to every entry when there are zero investigators", () => {
    expect(extractPhantomTickets([0, 1, 2], 0)).toEqual([
      { round: 1, ticket: 0 },
      { round: 2, ticket: 1 },
      { round: 3, ticket: 2 },
    ]);
  });
});

describe("computeShadow", () => {
  it("is every node on the map before the Phantom has moved or revealed", () => {
    expect(computeShadow(GRAPH, [], [])).toEqual(new Set([1, 2, 3, 4]));
  });

  it("shrinks to only nodes reachable by the announced ticket type", () => {
    // From "anywhere", a taxi hop can only land on 2 or 4 (the taxi edges
    // are 1-2 and 1-4) or 1 (via 2's return-taxi to 1) — node 3 has no
    // taxi edge at all, so it drops out.
    const shadow = computeShadow(GRAPH, [{ round: 1, ticket: 0 }], []);
    expect(shadow).toEqual(new Set([1, 2, 4]));
  });

  it("collapses to exactly the revealed node at a reveal round", () => {
    const shadow = computeShadow(
      GRAPH,
      [{ round: 1, ticket: 0 }],
      [{ round: 1, node: 2 }],
    );
    expect(shadow).toEqual(new Set([2]));
  });

  it("re-expands from the revealed node on the next announced ticket", () => {
    const shadow = computeShadow(
      GRAPH,
      [
        { round: 1, ticket: 0 }, // taxi -> collapses to {2} at the reveal below
        { round: 2, ticket: 1 }, // bus, from {2}
      ],
      [{ round: 1, node: 2 }],
    );
    // Node 2's only bus edge goes to 3.
    expect(shadow).toEqual(new Set([3]));
  });

  it("is empty if the announced ticket type has no matching edge from any candidate", () => {
    // Node 4's only edges are rail (to 3) and taxi (to 1) — no bus edge —
    // so once collapsed to {4}, a bus announcement has nowhere to go.
    const shadow = computeShadow(
      GRAPH,
      [
        { round: 1, ticket: 2 },
        { round: 2, ticket: 1 },
      ],
      [{ round: 1, node: 4 }],
    );
    expect(shadow).toEqual(new Set());
  });
});
