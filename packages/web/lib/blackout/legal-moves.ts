// Graph-based public-move legality (M8.5): human-Phantom matches have no
// server-side engine mirror (the server never learns the Phantom's
// position, so it cannot replay hidden moves through the engine). For
// those matches, investigator legality is derived directly from the public
// city graph + the chain's own state — the exact same adjacency + ticket
// rule the mirror would have enforced.

import type { Move } from "@zktable/core";
import type { ChainGameState } from "@zktable/blackout";
import { CITY_GRAPH } from "../board/city-graph";
import { movesFrom } from "../board/shadow";

/** Legal `{ type: "move", to, ticket }` moves for an investigator seat, from chain state. */
export function legalPublicMovesFromChain(state: ChainGameState, playerIdx: number): Move[] {
  const player = state.players[playerIdx];
  if (!player || player.public_node === null) return [];
  const resources = player.resources;
  return movesFrom(CITY_GRAPH, player.public_node)
    .filter(({ ticket }) => (resources[ticket] ?? 0) > 0)
    .map(({ to, ticket }) => ({ type: "move", to, ticket }));
}
