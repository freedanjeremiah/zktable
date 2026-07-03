// The "possible Phantom locations" shadow — the deduction centerpiece of
// the Blackout board. Pure inference over PUBLIC data only: the transit
// graph (`lib/map/city.json`), the on-chain `ticketFeed`, and `revealLog`.
// No secret input is ever touched — the same computation a real
// Investigator sitting at the board could do with a pencil.
//
// Two on-chain facts this reasons from (see
// `packages/contracts/contracts/referee/src/lib.rs` and
// `games/blackout/src/blackout.ts`):
//   - `ticket_feed` is a FLAT sequence of every player's ticket, phantom and
//     investigators alike, in strict turn order (phantom first, then
//     investigators in join order, repeating every round —
//     `turn.order: 'roles'`). It is not per-player-tagged on-chain, so the
//     Phantom's own entries must be picked out by position.
//   - `reveal_log` publishes the Phantom's exact node at reveal rounds only.
//
// The shadow itself: start "anywhere on the map" (nobody knows the
// Phantom's start position, not even at round 1); each announced Phantom
// ticket EXPANDS the candidate set to every node reachable from it by that
// ticket type; each reveal COLLAPSES the set to exactly the revealed node.

export type Ticket = 0 | 1 | 2;

export type GraphLike = {
  nodes: number[];
  edges: Array<{ from: number; to: number; ticket: Ticket }>;
  /** Defaults to true, matching `lib/map/city.json` — edges are undirected. */
  bidirectional?: boolean;
};

export type RevealEntry = { round: number; node: number };

/** One ticket the Phantom announced on its own turn, in round order. */
export type PhantomTicketEvent = { round: number; ticket: Ticket };

/**
 * Picks the Phantom's own entries out of the flat, chain-level
 * `ticketFeed`. Turn order is phantom-then-investigators repeating, so with
 * `investigatorCount` investigators the cycle length is `investigatorCount
 * + 1` and the Phantom's round-`r` entry sits at index `(r-1) * cycleLen`.
 */
export function extractPhantomTickets(
  ticketFeed: number[],
  investigatorCount: number,
): PhantomTicketEvent[] {
  const cycleLen = investigatorCount + 1;
  if (cycleLen <= 0) return [];
  const out: PhantomTicketEvent[] = [];
  for (let round = 1; (round - 1) * cycleLen < ticketFeed.length; round++) {
    const ticket = ticketFeed[(round - 1) * cycleLen] as Ticket;
    out.push({ round, ticket });
  }
  return out;
}

function buildAdjacency(graph: GraphLike): Map<number, Array<{ to: number; ticket: Ticket }>> {
  const adjacency = new Map<number, Array<{ to: number; ticket: Ticket }>>();
  const add = (from: number, to: number, ticket: Ticket) => {
    const list = adjacency.get(from);
    if (list) list.push({ to, ticket });
    else adjacency.set(from, [{ to, ticket }]);
  };
  for (const e of graph.edges) {
    add(e.from, e.to, e.ticket);
    if (graph.bidirectional !== false) add(e.to, e.from, e.ticket);
  }
  return adjacency;
}

function expand(
  adjacency: Map<number, Array<{ to: number; ticket: Ticket }>>,
  candidates: Set<number>,
  ticket: Ticket,
): Set<number> {
  const next = new Set<number>();
  for (const node of candidates) {
    for (const neighbor of adjacency.get(node) ?? []) {
      if (neighbor.ticket === ticket) next.add(neighbor.to);
    }
  }
  return next;
}

/**
 * The set of nodes the Phantom could occupy right now, given only public
 * information. Replays `phantomTickets` in round order: each ticket
 * expands the candidate set along edges of that type; a reveal at the same
 * round collapses it to exactly the revealed node.
 */
export function computeShadow(
  graph: GraphLike,
  phantomTickets: PhantomTicketEvent[],
  revealLog: RevealEntry[],
): Set<number> {
  const adjacency = buildAdjacency(graph);
  const revealByRound = new Map(revealLog.map((r) => [r.round, r.node]));

  let candidates = new Set<number>(graph.nodes);
  for (const { round, ticket } of phantomTickets) {
    candidates = expand(adjacency, candidates, ticket);
    const revealedNode = revealByRound.get(round);
    if (revealedNode !== undefined) {
      candidates = new Set([revealedNode]);
    }
  }
  return candidates;
}
