// M8.5 CLI-parity gate (the spec's "step 0" spike, kept as a permanent
// regression test): the browser proving stack (bb.js WASM + noir_js) must
// produce artifacts byte-compatible with the CLI pipeline (`zktable-graph`
// + `nargo` + `bb`) that the on-chain verifier was built around.
//
// Node-side test (bb.js runs in Node too); the LIBRARY stays browser-pure —
// all file I/O lives here.
//
// Golden vectors:
//  - commit(5, 12345) — the constant pinned in the Blackout referee's Rust
//    tests, produced by `zktable-graph commit --node 5 --salt 12345`.
//  - The committed `move_along` fixture set
//    (packages/contracts/contracts/referee/tests/fixtures): its
//    public_inputs blob is the CLI ground truth for root/c_old/c_new.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { initPoseidon, poseidon2, toBe32Hex } from "./fields.js";
import { buildEdgeTree } from "./graph.js";
import type { GraphData } from "./graph.js";
import { createWebProver } from "./prover.js";
import type { WebBoardProver } from "./prover.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../..");
const MOVE_ALONG_JSON = path.join(REPO_ROOT, "packages/circuits/move_along/target/move_along.json");
const CITY_JSON = path.join(REPO_ROOT, "games/blackout/map/city.json");

// zktable-graph commit --node 5 --salt 12345 (constant from the referee tests).
const KNOWN_COMMITMENT = "1be75cf9bc734dc2f3dda9e274fc5809a73db9cc1d2f677f4f021b3895028836";
// zktable-graph root --graph games/blackout/map/city.json (the live map's
// on-chain root — the same value every Blackout referee deploy pins).
const CITY_ROOT = "269be05bcbc68ecee8560f389c450f6a8f99a3b34343862b9762e55801092c5d";

let graph: GraphData;
let circuit: CompiledCircuit;

beforeAll(async () => {
  await initPoseidon();
  graph = JSON.parse(await readFile(CITY_JSON, "utf8")) as GraphData;
  circuit = JSON.parse(await readFile(MOVE_ALONG_JSON, "utf8")) as CompiledCircuit;
});

describe("Poseidon2 golden vectors (browser WASM vs zktable-graph)", () => {
  it("commit(5, 12345) matches the CLI constant", () => {
    expect(toBe32Hex(poseidon2(5n, 12345n))).toBe(KNOWN_COMMITMENT);
  });

  it("the TS edge tree reproduces the CLI city-map root", () => {
    const tree = buildEdgeTree(graph);
    expect(toBe32Hex(tree.root)).toBe(CITY_ROOT);
  });
});

describe("browser proof — CLI-compatible end to end", () => {
  let prover: WebBoardProver;

  beforeAll(async () => {
    prover = await createWebProver({ circuit, graph });
  });

  it("proves a legal hidden move and verifies it locally (keccak oracle)", async () => {
    const edge = graph.edges[0]!;
    const proof = await prover.prove({
      from: edge.from,
      to: edge.to,
      ticket: edge.ticket as 0 | 1 | 2,
      saltOld: 111111n,
      saltNew: 222222n,
    });

    // Same artifact shapes the CLI pipeline produces and the contract expects.
    expect(proof.proof.length).toBe(14592);
    expect(proof.publicInputs.length).toBe(128);
    expect(proof.rootHex).toBe(CITY_ROOT);
    expect(proof.cOldHex).toBe(toBe32Hex(poseidon2(BigInt(edge.from), 111111n)));

    await expect(prover.verifyLocally(proof)).resolves.toBe(true);
  }, 300_000);

  it("rejects an illegal edge before proving", async () => {
    await expect(
      prover.prove({ from: 1, to: 1, ticket: 0, saltOld: 1n, saltNew: 2n }),
    ).rejects.toThrow(/not in graph/);
  });
});
