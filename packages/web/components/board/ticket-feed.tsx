import { Eye } from "lucide-react";
import { ticketLabel } from "@/lib/board/ticket-meta";
import type { PhantomTicketEvent } from "@/lib/board/shadow";
import { cn } from "@/lib/utils";

export interface TicketFeedProps {
  /** The full, raw on-chain feed — every player's ticket, in turn order. */
  ticketFeed: number[];
  /** The subset that's the Phantom's own — the real clue. */
  phantomTickets: PhantomTicketEvent[];
  /** Turn-cycle length (investigators + 1) — same arithmetic as `extractPhantomTickets`. */
  cycleLen: number;
  revealRounds: Set<number>;
  className?: string;
}

/**
 * The on-chain ticket feed as a timeline — the core deduction clue. Every
 * entry is a real chain-confirmed ticket type; Phantom entries (the ones
 * `lib/board/shadow.ts` reasons over) are called out in brass, everyone
 * else's fade into the background. Reveal rounds get a flag.
 */
export function TicketFeed({ ticketFeed, phantomTickets, cycleLen, revealRounds, className }: TicketFeedProps) {
  // Exact index of each Phantom round's entry — same arithmetic
  // `extractPhantomTickets` used to find it in the first place.
  const phantomRoundByIndex = new Map<number, number>();
  for (const ev of phantomTickets) {
    phantomRoundByIndex.set((ev.round - 1) * cycleLen, ev.round);
  }

  if (ticketFeed.length === 0) {
    return (
      <p className={cn("text-sm text-fg-subtle", className)}>
        No tickets announced yet — the Phantom opens the match.
      </p>
    );
  }

  return (
    <ol className={cn("flex flex-wrap gap-1.5", className)}>
      {ticketFeed.map((ticket, i) => {
        const phantomRound = phantomRoundByIndex.get(i);
        const isPhantom = phantomRound !== undefined;
        const isReveal = isPhantom && revealRounds.has(phantomRound);
        return (
          <li
            key={i}
            className={cn(
              "inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.06em]",
              isPhantom
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-fg-subtle",
            )}
            title={
              isPhantom
                ? `Phantom — round ${phantomRound} — ${ticketLabel(ticket)}${isReveal ? " — reveal round" : ""}`
                : `Investigator — ${ticketLabel(ticket)}`
            }
          >
            {isReveal ? <Eye className="h-2.5 w-2.5" strokeWidth={2.5} /> : null}
            {ticketLabel(ticket).slice(0, 1)}
          </li>
        );
      })}
    </ol>
  );
}
