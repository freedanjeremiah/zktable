// Browser-side port of `zktable-graph`'s edge-tree builder (M8.5): the
// canonical directed-edge ordering, depth-10 Merkle tree, and
// authentication-path extraction — line-for-line the same derivation as
// `packages/contracts/tools/graph-tools/src/main.rs` (`canonical_edges`,
// `build_tree`, `merkle_path`), pinned by golden-vector tests against the
// Rust tool's committed outputs. The graph is PUBLIC data; only positions
// and salts are secret, and those never enter this file.

import { poseidon2 } from "./fields.js";

export const TREE_DEPTH = 10;
export const N_LEAVES = 1 << TREE_DEPTH;

export type GraphData = {
  nodes?: number[];
  edges: Array<{ from: number; to: number; ticket: number }>;
  /** If true (default), each listed edge is expanded to both directions. */
  bidirectional?: boolean;
};

export type Edge = [from: number, to: number, ticket: number];

/** Canonical directed edge list: expand bidirectional, dedupe, sort. */
export function canonicalEdges(graph: GraphData): Edge[] {
  const set: Edge[] = [];
  const bidirectional = graph.bidirectional ?? true;
  for (const e of graph.edges) {
    set.push([e.from, e.to, e.ticket]);
    if (bidirectional) set.push([e.to, e.from, e.ticket]);
  }
  set.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return set.filter((e, i) => i === 0 || e[0] !== set[i - 1]![0] || e[1] !== set[i - 1]![1] || e[2] !== set[i - 1]![2]);
}

function edgeLeaf(from: bigint, to: bigint, ticket: bigint): bigint {
  return poseidon2(poseidon2(from, to), ticket);
}

export type EdgeTree = {
  levels: bigint[][];
  indexByEdge: Map<string, number>;
  root: bigint;
};

function edgeKey(e: Edge): string {
  return `${e[0]},${e[1]},${e[2]}`;
}

/** Full depth-10 tree; levels[0] = leaves (zero-padded), levels[10] = [root]. */
export function buildEdgeTree(graph: GraphData): EdgeTree {
  const edges = canonicalEdges(graph);
  if (edges.length > N_LEAVES) throw new Error("too many edges for TREE_DEPTH");
  const indexByEdge = new Map<string, number>();
  const leaves: bigint[] = [];
  edges.forEach((e, i) => {
    indexByEdge.set(edgeKey(e), i);
    leaves.push(edgeLeaf(BigInt(e[0]), BigInt(e[1]), BigInt(e[2])));
  });
  while (leaves.length < N_LEAVES) leaves.push(0n);

  const levels: bigint[][] = [leaves];
  for (let d = 0; d < TREE_DEPTH; d++) {
    const prev = levels[d]!;
    const next: bigint[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(poseidon2(prev[i]!, prev[i + 1]!));
    }
    levels.push(next);
  }
  return { levels, indexByEdge, root: levels[TREE_DEPTH]![0]! };
}

export type MerklePath = { siblings: bigint[]; bits: number[] };

/** Authentication path for the edge (from, to, ticket). bit=0 -> node is left. */
export function merklePath(tree: EdgeTree, edge: Edge): MerklePath {
  const idx = tree.indexByEdge.get(edgeKey(edge));
  if (idx === undefined) {
    throw new Error(`edge (${edge[0]},${edge[1]},ticket=${edge[2]}) not in graph`);
  }
  const siblings: bigint[] = [];
  const bits: number[] = [];
  let pos = idx;
  for (let d = 0; d < TREE_DEPTH; d++) {
    const bit = pos & 1;
    const sib = bit === 0 ? pos + 1 : pos - 1;
    siblings.push(tree.levels[d]![sib]!);
    bits.push(bit);
    pos >>= 1;
  }
  return { siblings, bits };
}
