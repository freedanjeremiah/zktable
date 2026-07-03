// Coup-lite state -> DTO. The human sees their own hand always; the AI's
// live cards stay hidden (only DEAD/revealed cards are public).

import type { PlayerId } from "@zktable/core";
import { CHARACTER_NAMES } from "@zktable/coup-lite";
import type { ChainGameState } from "@zktable/coup-lite";
import type { CoupMatchEvent, CoupMatchRuntime } from "./store";

export type CoupDtoPlayer = {
  index: number;
  id: PlayerId;
  isHuman: boolean;
  influence: number;
  alive: boolean;
  /** Own hand (character ids); null for the AI's still-hidden cards. */
  hand: number[] | null;
  /** dead[i] === true means slot i was revealed/discarded. */
  dead: boolean[];
};

export type CoupDto = {
  matchId: string;
  refereeId: string;
  explorerUrl: string;
  phase: string;
  turnIndex: number;
  currentIsHuman: boolean;
  players: CoupDtoPlayer[];
  characterNames: string[];
  lastClaim: { player: number; character: number } | null;
  outcome: { index: number; id: PlayerId } | null;
  log: CoupMatchEvent[];
};

export function toCoupDto(state: ChainGameState, runtime: CoupMatchRuntime): CoupDto {
  const players: CoupDtoPlayer[] = runtime.roster.map((p, index) => {
    const chain = state.players[index];
    const isHuman = index === runtime.humanIdx;
    return {
      index,
      id: p.id,
      isHuman,
      influence: chain?.influence ?? 0,
      alive: chain?.alive ?? true,
      hand: isHuman ? runtime.handsByPlayer[p.id] ?? [] : null,
      dead: chain?.dead ?? [false, false],
    };
  });

  return {
    matchId: runtime.id,
    refereeId: runtime.refereeId,
    explorerUrl: runtime.explorerUrl,
    phase: state.phase,
    turnIndex: state.turn,
    currentIsHuman: state.turn === runtime.humanIdx,
    players,
    characterNames: [...CHARACTER_NAMES],
    lastClaim:
      state.last_claim_player !== null && state.last_claim_character !== null
        ? { player: state.last_claim_player, character: state.last_claim_character }
        : null,
    outcome:
      state.outcome !== null && state.outcome !== undefined
        ? { index: state.outcome, id: runtime.roster[state.outcome]!.id }
        : null,
    log: runtime.log,
  };
}
