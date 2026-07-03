// Graph-based public-move legality (M8.5): human-Phantom matches have no
// server-side engine mirror (the server never learns the Phantom's
// position, so it cannot replay hidden moves through the engine). For
// those matches, investigator legality is derived directly from the public
// city graph + the chain's own state — the exact same adjacency + ticket
// rule the mirror would have enforced.

import type { Move } from "@zktable/core";
import type { ChainGameState } from "@zktable/blackout";
import { CITY_GRAPH } from "../board/city-graph";

const TICKETS = [0, 1, 2] as const;

/** Legal `{ type: "move", to, ticket }` moves for an investigator seat, from chain state. */
export function legalPublicMovesFromChain(state: ChainGameState, playerIdx: number): Move[] {
  const player = state.players[playerIdx];
  if (!player || player.public_node === null) return [];
  const from = player.public_node;
  const resources = player.resources;

  const moves: Move[] = [];
  for (const ticket of TICKETS) {
    if ((resources[ticket] ?? 0) === 0) continue;
    for (const edge of CITY_GRAPH.edges) {
      if (edge.ticket !== ticket) continue;
      if (edge.from === from) moves.push({ type: "move", to: edge.to, ticket });
      else if (CITY_GRAPH.bidirectional && edge.to === from) moves.push({ type: "move", to: edge.from, ticket });
    }
  }
  return moves;
}
