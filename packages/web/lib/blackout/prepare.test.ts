// Unit tests for the Freighter prepare/sign/submit CLI plumbing: assert the
// exact `stellar` argv shapes (build-only sourced from the WALLET address,
// simulate on the built XDR, send on the signed XDR) with execFile mocked —
// no chain, no binaries.

import { describe, expect, it, vi } from "vitest";

const execCalls: Array<{ bin: string; args: string[] }> = [];

vi.mock("node:child_process", () => {
  const custom = Symbol.for("nodejs.util.promisify.custom");
  const execFile = (() => {
    throw new Error("callback-style execFile not expected");
  }) as unknown as Record<symbol, unknown>;
  execFile[custom] = async (bin: string, args: string[]) => {
    execCalls.push({ bin, args });
    // First call (build-only) returns a fake raw XDR; second (simulate)
    // returns the "assembled" XDR; send returns a tx result blob.
    if (args.includes("--build-only")) return { stdout: "RAW_XDR\n", stderr: "" };
    if (args[1] === "simulate") return { stdout: "ASSEMBLED_XDR\n", stderr: "" };
    return { stdout: "SENT\n", stderr: "" };
  };
  return { execFile };
});

import { buildUnsignedInvokeXdr, sendSignedTx } from "./prepare";

describe("buildUnsignedInvokeXdr", () => {
  it("builds with --build-only sourced from the wallet address, then simulates the result", async () => {
    execCalls.length = 0;
    const xdr = await buildUnsignedInvokeXdr({
      contractId: "CREFEREE",
      network: "testnet",
      sourceAccount: "GWALLET",
      method: "submit_public_move",
      methodArgs: ["--player", "1", "--node", "5", "--ticket", "0"],
    });

    expect(xdr).toBe("ASSEMBLED_XDR");
    expect(execCalls).toHaveLength(2);

    const build = execCalls[0]!.args;
    expect(build.slice(0, 2)).toEqual(["contract", "invoke"]);
    expect(build[build.indexOf("--source-account") + 1]).toBe("GWALLET");
    expect(build).toContain("--build-only");
    expect(build.slice(build.indexOf("--") + 1)).toEqual([
      "submit_public_move",
      "--player",
      "1",
      "--node",
      "5",
      "--ticket",
      "0",
    ]);

    const simulate = execCalls[1]!.args;
    expect(simulate.slice(0, 2)).toEqual(["tx", "simulate"]);
    expect(simulate[simulate.indexOf("--source-account") + 1]).toBe("GWALLET");
    expect(simulate.at(-1)).toBe("RAW_XDR");
  });
});

describe("sendSignedTx", () => {
  it("sends the signed envelope via `stellar tx send`", async () => {
    execCalls.length = 0;
    const out = await sendSignedTx("testnet", "SIGNED_XDR");
    expect(out).toBe("SENT");
    const send = execCalls[0]!.args;
    expect(send.slice(0, 2)).toEqual(["tx", "send"]);
    expect(send.at(-1)).toBe("SIGNED_XDR");
    expect(send[send.indexOf("--network") + 1]).toBe("testnet");
  });
});
