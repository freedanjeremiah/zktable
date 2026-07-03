// In-memory match store for the Liar's Dice web arcade (demo scope — one
// process, like Blackout's original store before its M8.4 durability work;
// these two secondary games don't yet carry the record/hydrate machinery).
// A `Map` on `globalThis` so it survives Next.js dev-server HMR.

import type { Match, PlayerId } from "@zktable/core";
import type { ChainGameState, CliRefereeClient, DiceProver, Roster } from "@zktable/liars-dice";

export type LiarsMatchEvent =
  | { type: "bid"; player: PlayerId; quantity: number; face: number; at: number; tx?: string | null }
  | { type: "challenge"; player: PlayerId; at: number; tx?: string | null }
  | { type: "reveal"; player: PlayerId; dice: number[]; at: number; tx?: string | null }
  | { type: "roll"; player: PlayerId; at: number; tx?: string | null }
  | { type: "error"; message: string; at: number };

export type LiarsMatchRuntime = {
  id: string;
  refereeId: string;
  verifierId: string;
  client: CliRefereeClient;
  prover: DiceProver;
  roster: Roster;
  /** The human seat index (0); AI fills the rest. */
  humanIdx: number;
  /** Every seat's REAL rolled dice (seed-derived, server-proven) — the human
   *  sees only their OWN via the DTO. */
  diceByPlayer: Record<PlayerId, number[]>;
  saltsByPlayer: Record<PlayerId, bigint[]>;
  /** Local `@zktable/core` mirror, in lockstep with the chain (drives the AI
   *  strategy + the human's legal bids). */
  local: Match;
  seedHex: string;
  seed: string;
  explorerUrl: string;
  network: string;
  source: string;
  createdAt: number;
  log: LiarsMatchEvent[];
  lastChainState?: ChainGameState;
};

const KEY = "__zktableLiarsDiceStore__";

function store(): Map<string, LiarsMatchRuntime> {
  const g = globalThis as unknown as Record<string, Map<string, LiarsMatchRuntime> | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}

export function saveLiarsMatch(runtime: LiarsMatchRuntime): void {
  store().set(runtime.id, runtime);
}

export function getLiarsMatch(id: string): LiarsMatchRuntime | undefined {
  return store().get(id);
}
