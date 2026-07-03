import { TICKET_COLOR_VAR, TICKET_LABELS } from "@/lib/board/ticket-meta";
import type { Ticket } from "@/lib/board/ticket-meta";

const TICKETS: Ticket[] = [0, 1, 2];

/** Small legend for the three transit-line colors on `<TransitMap/>`. */
export function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-fg-subtle">
      {TICKETS.map((t) => (
        <span key={t} className="inline-flex items-center gap-1.5">
          <span
            className="h-[2px] w-4 rounded-full"
            style={{ backgroundColor: TICKET_COLOR_VAR[t] }}
            aria-hidden
          />
          {TICKET_LABELS[t]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-hidden" aria-hidden />
        Possible Phantom location
      </span>
    </div>
  );
}
