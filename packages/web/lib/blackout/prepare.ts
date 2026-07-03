// Freighter prepare/sign/submit plumbing (M8.1): the server builds an
// UNSIGNED Soroban transaction for the human investigator's own wallet
// address (whose seat the referee's require_auth() protects), the browser
// signs it with Freighter, and the server submits the signed envelope.
// Shells out to the same `stellar` CLI every other chain call in this repo
// uses; `--build-only` + `tx simulate` produce a fully-assembled envelope
// ready for a source-account signature.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DEFAULT_STELLAR_BIN, toolEnv } from "@zktable/blackout";
import { BlackoutApiError } from "./errors";

const execFileAsync = promisify(execFile);

async function stellar(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(DEFAULT_STELLAR_BIN, args, {
      env: toolEnv(),
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const stderr =
      typeof err === "object" && err !== null && "stderr" in err
        ? String((err as { stderr: unknown }).stderr)
        : String(err);
    throw new BlackoutApiError(502, `stellar ${args.slice(0, 3).join(" ")}… failed: ${stderr.trim().slice(0, 400)}`);
  }
}

/**
 * Builds and simulates an invocation of `method` on `contractId` with the
 * given `--flag value` args, sourced from `sourceAccount` (a G-address the
 * server does NOT hold a key for). Returns the assembled, unsigned
 * transaction envelope XDR the wallet must sign.
 */
export async function buildUnsignedInvokeXdr(opts: {
  contractId: string;
  network: string;
  sourceAccount: string;
  method: string;
  methodArgs: string[];
}): Promise<string> {
  const raw = await stellar([
    "contract",
    "invoke",
    "--id",
    opts.contractId,
    "--source-account",
    opts.sourceAccount,
    "--network",
    opts.network,
    "--build-only",
    "--",
    opts.method,
    ...opts.methodArgs,
  ]);
  return stellar([
    "tx",
    "simulate",
    "--source-account",
    opts.sourceAccount,
    "--network",
    opts.network,
    raw,
  ]);
}

/** Submits a signed transaction envelope; returns the CLI's response (tx result). */
export async function sendSignedTx(network: string, signedXdr: string): Promise<string> {
  return stellar(["tx", "send", "--network", network, signedXdr]);
}
