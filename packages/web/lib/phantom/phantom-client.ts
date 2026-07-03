// Browser-side human-Phantom driver (M8.5). Owns the ONLY copy of the
// Phantom's secret (position + salts, in localStorage keyed by match id),
// computes phantom legal moves from the public city graph, and produces
// real UltraHonk proofs in the browser via @zktable/prover-web — the
// server only ever sees commitments, tickets, and proof bytes.

import type { WebBoardProver } from "@zktable/prover-web";
import { CITY_GRAPH } from "../board/city-graph";
import { movesFrom } from "../board/shadow";

/**
 * Local copy ON PURPOSE: a runtime import from @zktable/prover-web would
 * pull bb.js into the page bundle EAGERLY (its module init throws in a
 * non-isolated context and defeats the lazy-WASM design) — only the
 * type-only import above and the dynamic import in getPhantomProver may
 * reference that package.
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export type PhantomSecret = {
  pos: number;
  salt: string;
  /** The next (pos, salt) staged by a proven-but-unconfirmed move. Promoted
   *  only after the server accepts the submission — rotating eagerly would
   *  destroy the only copy of the CURRENT salt and brick the match if the
   *  POST fails. */
  pending?: { pos: number; salt: string };
};

const STORAGE_PREFIX = "zktable-phantom-";

export function loadPhantomSecret(matchId: string): PhantomSecret | null {
  const raw = localStorage.getItem(STORAGE_PREFIX + matchId);
  return raw ? (JSON.parse(raw) as PhantomSecret) : null;
}

export function savePhantomSecret(matchId: string, secret: PhantomSecret): void {
  localStorage.setItem(STORAGE_PREFIX + matchId, JSON.stringify(secret));
}

/** Promote the staged move after the server confirmed the submission landed. */
export function confirmPhantomMove(matchId: string): void {
  const secret = loadPhantomSecret(matchId);
  if (!secret?.pending) return;
  savePhantomSecret(matchId, { pos: secret.pending.pos, salt: secret.pending.salt });
}

/** Drop the staged move after a failed submission (the current secret stays authoritative). */
export function discardPendingPhantomMove(matchId: string): void {
  const secret = loadPhantomSecret(matchId);
  if (!secret?.pending) return;
  savePhantomSecret(matchId, { pos: secret.pos, salt: secret.salt });
}

/** A cryptographically random field-sized salt (browser webcrypto). */
export function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** A random starting node for the Phantom. */
export function randomStartNode(): number {
  const nodes = CITY_GRAPH.nodes;
  const idx = new Uint32Array(1);
  crypto.getRandomValues(idx);
  return nodes[idx[0]! % nodes.length]!;
}

export type PhantomMoveOption = { to: number; ticket: 0 | 1 | 2 };

/** Legal phantom moves from the secret position, filtered by remaining tickets. */
export function phantomLegalMoves(pos: number, tickets: { taxi: number; bus: number; rail: number }): PhantomMoveOption[] {
  const remaining = [tickets.taxi, tickets.bus, tickets.rail];
  return movesFrom(CITY_GRAPH, pos).filter(({ ticket }) => (remaining[ticket] ?? 0) > 0);
}

let proverPromise: Promise<WebBoardProver> | null = null;

/**
 * Lazily builds the browser prover: fetches the ACIR artifact (static
 * asset), then dynamic-imports the proving stack so non-Phantom visitors
 * never download the WASM.
 */
export function getPhantomProver(): Promise<WebBoardProver> {
  if (!proverPromise) {
    proverPromise = (async () => {
      const [{ createWebProver }, circuitRes] = await Promise.all([
        import("@zktable/prover-web"),
        fetch("/circuits/move_along.json"),
      ]);
      if (!circuitRes.ok) {
        throw new Error("could not load the move_along circuit artifact (run the web app's ensure-circuit-assets script)");
      }
      const circuit = await circuitRes.json();
      return createWebProver({ circuit, graph: CITY_GRAPH });
    })();
  }
  return proverPromise;
}

/** Commitment for a fresh start position; stores the secret locally. */
export async function preparePhantomStart(matchId: string): Promise<{ commitmentHex: string }> {
  const prover = await getPhantomProver();
  const secret: PhantomSecret = { pos: randomStartNode(), salt: randomSaltHex() };
  savePhantomSecret(matchId, secret);
  return { commitmentHex: prover.commit(secret.pos, BigInt(`0x${secret.salt}`)) };
}

/**
 * Proves one hidden move IN THE BROWSER and STAGES the rotated secret
 * (promotion happens via `confirmPhantomMove` only after the server accepts
 * the submission). Returns the payload for POST .../phantom-move.
 */
export async function provePhantomMove(
  matchId: string,
  move: PhantomMoveOption,
): Promise<{ cNewHex: string; ticket: number; proofHex: string }> {
  const secret = loadPhantomSecret(matchId);
  if (!secret) throw new Error("no Phantom secret stored for this match in this browser");
  const prover = await getPhantomProver();
  const saltNew = randomSaltHex();
  const proof = await prover.prove({
    from: secret.pos,
    to: move.to,
    ticket: move.ticket,
    saltOld: BigInt(`0x${secret.salt}`),
    saltNew: BigInt(`0x${saltNew}`),
  });
  savePhantomSecret(matchId, { pos: secret.pos, salt: secret.salt, pending: { pos: move.to, salt: saltNew } });
  return {
    cNewHex: proof.cNewHex,
    ticket: move.ticket,
    proofHex: bytesToHex(proof.proof),
  };
}

/** The reveal payload for POST .../phantom-reveal (public by design at reveal rounds). */
export function phantomRevealPayload(matchId: string): { node: number; saltHex: string } {
  const secret = loadPhantomSecret(matchId);
  if (!secret) throw new Error("no Phantom secret stored for this match in this browser");
  return { node: secret.pos, saltHex: secret.salt.padStart(64, "0") };
}
