export {
  DICE_PER_PLAYER,
  N_PLAYERS,
  SIDES,
  liarsDice,
  seededRoll,
} from './liars-dice.js'
export type { BidEntry, LiarsDiceConfig } from './liars-dice.js'
export { chooseMove, pickSeeded } from './strategy.js'
export { DiceProver } from './dice-prover.js'
export type { DiceProof, DiceProverOptions } from './dice-prover.js'
export { CliRefereeClient, RefereeCliError, stripHexPrefix, toBe32Hex } from './referee-client.js'
export type { ChainBid, ChainGameState, ChainPlayer, Phase } from './referee-client.js'
export { buildRoster, createLocalMatch, playLiarsDice, playLocalMatch, stepLocalMatch } from './runner.js'
export type { LocalStep, PlayLiarsDiceOptions, Roster, Transcript } from './runner.js'
