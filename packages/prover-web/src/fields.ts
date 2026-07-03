// Field helpers + the browser-side Poseidon2 (M8.5).
//
// THE load-bearing invariant (architecture invariant #3): this hash must be
// byte-identical to the Noir circuits' `Poseidon2::hash([a,b], 2)`, the
// on-chain referees' `poseidon2_hash2`, and `zktable-graph`'s `hash2`. All
// of those are Barretenberg's Poseidon2 — and so is this one: we call
// straight into Barretenberg's own WASM via bb.js, so agreement is by
// construction, then pinned by golden-vector tests against committed
// `zktable-graph` outputs.

import { BarretenbergSync, Fr } from "@aztec/bb.js";

let sync: BarretenbergSync | null = null;

/** One-time WASM init (idempotent). Call before any `poseidon2` use. */
export async function initPoseidon(): Promise<void> {
  if (sync) return;
  sync = await BarretenbergSync.initSingleton();
}

export function toFr(value: bigint): Fr {
  return new Fr(value);
}

export function frToBigInt(fr: Fr): bigint {
  return BigInt(fr.toString());
}

/** Poseidon2 over exactly two field elements — zkTable's universal `hash2`. */
export function poseidon2(a: bigint, b: bigint): bigint {
  if (!sync) throw new Error("poseidon2: call initPoseidon() first");
  return frToBigInt(sync.poseidon2Hash([toFr(a), toFr(b)]));
}

/** Lowercase hex (no 0x prefix) for arbitrary bytes — proofs, salts, blobs. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** 32-byte big-endian hex (no 0x prefix) — the CLI/contract Bytes encoding. */
export function toBe32Hex(value: bigint): string {
  if (value < 0n) throw new Error("toBe32Hex: value must be non-negative");
  const hex = value.toString(16);
  if (hex.length > 64) throw new Error("toBe32Hex: value does not fit in 32 bytes");
  return hex.padStart(64, "0");
}

/** Concatenate values as 32-byte big-endian words (the public-inputs blob shape). */
export function toBe32Blob(values: bigint[]): Uint8Array {
  const out = new Uint8Array(values.length * 32);
  values.forEach((v, i) => {
    const hex = toBe32Hex(v);
    for (let j = 0; j < 32; j++) {
      out[i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
    }
  });
  return out;
}
