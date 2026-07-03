// In-memory match store for the Coup-lite web arcade (demo scope, one
// process — like Blackout's original store). `Map` on `globalThis`.

import type { Match, PlayerId } from "@zktable/core";
import type { CardProver, ChainGameState, CliRefereeClient, Hand, Roster } from "@zktable/coup-lite";

export type CoupMatchEvent =
  | { type: "deal"; at: number; tx?: string | null }
  | { type: "claim"; player: PlayerId; character: number; at: number; tx?: string | null }
  | {
      type: "challenge";
      challenger: PlayerId;
      target: PlayerId;
      claimWasTrue: boolean;
      loser: PlayerId;
      at: number;
      /** The challenge tx; a truthful claim adds the card_membership proof tx. */
      tx?: string | null;
      proveTx?: string | null;
      revealTx?: string | null;
    }
  | { type: "error"; message: string; at: number };

export type CoupMatchRuntime = {
  id: string;
  refereeId: string;
  verifierId: string;
  shuffleVerifierId: string;
  client: CliRefereeClient;
  prover: CardProver;
  roster: Roster;
  humanIdx: number;
  handsByPlayer: Record<PlayerId, Hand>;
  saltsByPlayer: Record<PlayerId, [bigint, bigint]>;
  deadByPlayer: Record<PlayerId, [boolean, boolean]>;
  local: Match;
  seed: string;
  explorerUrl: string;
  network: string;
  source: string;
  createdAt: number;
  log: CoupMatchEvent[];
  lastChainState?: ChainGameState;
};

const KEY = "__zktableCoupLiteStore__";
function store(): Map<string, CoupMatchRuntime> {
  const g = globalThis as unknown as Record<string, Map<string, CoupMatchRuntime> | undefined>;
  if (!g[KEY]) g[KEY] = new Map();
  return g[KEY]!;
}
export function saveCoupMatch(r: CoupMatchRuntime): void { store().set(r.id, r); }
export function getCoupMatch(id: string): CoupMatchRuntime | undefined { return store().get(id); }
