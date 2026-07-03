// Shared, browser-safe constants describing the three Blackout ticket
// types and the match's round structure. Deliberately NOT imported from
// `@zktable/blackout` (that package's `map.ts` reads `map/city.json` off
// disk with `node:fs` at import time and `referee-client.ts` shells out —
// neither is safe in a client bundle). These mirror
// `games/blackout/src/blackout.ts`'s defaults, which the create-match API
// does not currently let callers override.

export type Ticket = 0 | 1 | 2;

export const TICKET_NAMES: Record<Ticket, string> = { 0: "taxi", 1: "bus", 2: "rail" };

export const TICKET_LABELS: Record<Ticket, string> = { 0: "Taxi", 1: "Bus", 2: "Rail" };

/** Three distinct, legible hues from the existing token set — none of them
 *  a near-background neutral (bus used to be `--color-fg-muted`, which
 *  vanished against the dark panel; `--color-success` is already in the
 *  palette and reads clearly at low opacity). */
export const TICKET_COLOR_VAR: Record<Ticket, string> = {
  0: "var(--color-accent)", // taxi — brass
  1: "var(--color-success)", // bus — sage green
  2: "var(--color-hidden)", // rail — cold slate
};

export const TICKET_EDGE_OPACITY: Record<Ticket, number> = {
  0: 0.65,
  1: 0.55,
  2: 0.55,
};

/** Mirrors `games/blackout/src/blackout.ts` `DEFAULT_N_ROUNDS`. */
export const DEFAULT_N_ROUNDS = 24;

/** Mirrors `games/blackout/src/blackout.ts` `DEFAULT_REVEAL_ROUNDS`. */
export const DEFAULT_REVEAL_ROUNDS = [3, 8, 13, 18, 24];

export function ticketLabel(ticket: number): string {
  return TICKET_LABELS[ticket as Ticket] ?? `ticket ${ticket}`;
}
