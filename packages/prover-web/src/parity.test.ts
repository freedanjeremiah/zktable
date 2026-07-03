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

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { UltraHonkBackend } from "@aztec/bb.js";
import type { CompiledCircuit } from "@noir-lang/noir_js";
import { bytesToHex, initPoseidon, poseidon2, toBe32Hex } from "./fields.js";
import { buildEdgeTree } from "./graph.js";
import type { GraphData } from "./graph.js";
import { createWebProver } from "./prover.js";
import type { WebBoardProver } from "./prover.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../..");
const MOVE_ALONG_JSON = path.join(REPO_ROOT, "packages/circuits/move_along/target/move_along.json");
const MOVE_ALONG_VK = path.join(REPO_ROOT, "packages/circuits/move_along/target/vk");
const CITY_JSON = path.join(REPO_ROOT, "games/blackout/map/city.json");
const GRAPH_TOOLS_BIN = path.join(
  REPO_ROOT,
  "packages/contracts/tools/graph-tools/target/release/zktable-graph",
);

const TOOL_ENV = {
  ...process.env,
  PATH: [path.join(os.homedir(), ".nargo/bin"), path.join(os.homedir(), ".bb/bin"), process.env.PATH ?? ""].join(
    path.delimiter,
  ),
};

/** Run a CLI if available; returns null (→ test skips loudly) when the tool is absent. */
function tryRun(bin: string, args: string[], opts: { input?: string } = {}): string | null {
  try {
    return execFileSync(bin, args, { env: TOOL_ENV, encoding: "utf8", input: opts.input });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

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

describe("CLI cross-checks — the on-chain verifier's exact artifacts", () => {
  it("bb.js derives the SAME verification key bytes as the CLI's bb write_vk", async () => {
    const cliVk = new Uint8Array(await readFile(MOVE_ALONG_VK));
    const backend = new UltraHonkBackend(circuit.bytecode);
    const wasmVk = await backend.getVerificationKey({ keccak: true });
    expect(bytesToHex(wasmVk)).toBe(bytesToHex(cliVk));
  }, 300_000);

  it("a browser-stack proof verifies with the native `bb verify` CLI against the CLI VK", async () => {
    const prover = await createWebProver({ circuit, graph });
    const edge = graph.edges[0]!;
    const proof = await prover.prove({
      from: edge.from,
      to: edge.to,
      ticket: edge.ticket as 0 | 1 | 2,
      saltOld: 333333n,
      saltNew: 444444n,
    });

    const dir = mkdtempSync(path.join(os.tmpdir(), "prover-web-parity-"));
    try {
      writeFileSync(path.join(dir, "proof"), proof.proof);
      writeFileSync(path.join(dir, "public_inputs"), proof.publicInputs);
      const out = tryRun("bb", [
        "verify",
        "--scheme",
        "ultra_honk",
        "--oracle_hash",
        "keccak",
        "-k",
        MOVE_ALONG_VK,
        "-p",
        path.join(dir, "proof"),
        "-i",
        path.join(dir, "public_inputs"),
      ]);
      if (out === null) {
        console.warn("[parity] bb CLI not on PATH — CLI verification skipped this run");
        return;
      }
      // bb verify exits non-zero on failure (execFileSync throws) and logs
      // "Proof verified successfully" to STDERR — reaching this line with a
      // non-null result IS the assertion.
      expect(out).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);

  it("public-inputs blob is byte-identical to `zktable-graph witness` for the same move", async () => {
    const edge = graph.edges[0]!;
    const dir = mkdtempSync(path.join(os.tmpdir(), "prover-web-witness-"));
    try {
      const out = tryRun(GRAPH_TOOLS_BIN, [
        "witness",
        "--graph",
        CITY_JSON,
        "--from",
        String(edge.from),
        "--to",
        String(edge.to),
        "--ticket",
        String(edge.ticket),
        "--salt-old",
        "111111",
        "--salt-new",
        "222222",
        "--prover",
        path.join(dir, "Prover.toml"),
        "--json",
        path.join(dir, "witness.json"),
      ]);
      if (out === null) {
        console.warn("[parity] zktable-graph binary not built — witness parity skipped this run");
        return;
      }
      const cli = JSON.parse(await readFile(path.join(dir, "witness.json"), "utf8")) as {
        public_inputs: string;
      };

      const prover = await createWebProver({ circuit, graph });
      const proof = await prover.prove({
        from: edge.from,
        to: edge.to,
        ticket: edge.ticket as 0 | 1 | 2,
        saltOld: 111111n,
        saltNew: 222222n,
      });
      expect(`0x${bytesToHex(proof.publicInputs)}`).toBe(cli.public_inputs);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
