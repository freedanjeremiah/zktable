// Liar's Dice state -> DTO. The human sees their OWN dice always, and every
// player's dice once the round is revealed (Finished) — never the AI's dice
// mid-round.

import type { PlayerId } from "@zktable/core";
import type { ChainGameState } from "@zktable/liars-dice";
import type { LiarsMatchEvent, LiarsMatchRuntime } from "./store";

export type LiarsDtoPlayer = {
  index: number;
  id: PlayerId;
  isHuman: boolean;
  isAi: boolean;
  diceCount: number;
  /** The player's dice, when this viewer may see them (own seat, or revealed). */
  dice: number[] | null;
  alive: boolean;
};

export type LiarsDto = {
  matchId: string;
  refereeId: string;
  explorerUrl: string;
  phase: string;
  round: number;
  turnIndex: number;
  currentIsHuman: boolean;
  players: LiarsDtoPlayer[];
  currentBid: { player: number; quantity: number; face: number } | null;
  bidHistory: Array<{ player: number; quantity: number; face: number }>;
  /** Total dice on the table — the honest ceiling for a legal bid quantity. */
  totalDice: number;
  sides: number;
  challenger: number | null;
  outcome: { index: number; id: PlayerId } | null;
  log: LiarsMatchEvent[];
};

export function toLiarsDto(state: ChainGameState, runtime: LiarsMatchRuntime): LiarsDto {
  const finished = state.phase === "Finished";
  const players: LiarsDtoPlayer[] = runtime.roster.map((p, index) => {
    const chain = state.players[index];
    const isHuman = index === runtime.humanIdx;
    const revealed = chain?.revealed_dice ?? [];
    const dice = isHuman ? runtime.diceByPlayer[p.id] ?? [] : finished && revealed.length > 0 ? revealed : null;
    return {
      index,
      id: p.id,
      isHuman,
      isAi: !isHuman,
      diceCount: (runtime.diceByPlayer[p.id] ?? []).length,
      dice,
      alive: chain?.alive ?? true,
    };
  });

  const cur = state.current_bid[0] ?? null;
  const totalDice = Object.values(runtime.diceByPlayer).reduce((sum, d) => sum + d.length, 0);

  return {
    matchId: runtime.id,
    refereeId: runtime.refereeId,
    explorerUrl: runtime.explorerUrl,
    phase: state.phase,
    round: 1,
    turnIndex: state.turn,
    currentIsHuman: state.turn === runtime.humanIdx,
    players,
    currentBid: cur ? { player: cur.player, quantity: cur.quantity, face: cur.face } : null,
    bidHistory: state.bid_history.map((b) => ({ player: b.player, quantity: b.quantity, face: b.face })),
    totalDice,
    sides: state.sides,
    challenger: state.challenger,
    outcome:
      state.outcome !== null && state.outcome !== undefined
        ? { index: state.outcome, id: runtime.roster[state.outcome]!.id }
        : null,
    log: runtime.log,
  };
}
