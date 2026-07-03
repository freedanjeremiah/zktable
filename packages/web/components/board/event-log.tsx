import { AlertCircle, Eye, MapPin, ShieldCheck } from "lucide-react";
import { TxLink } from "@/components/proof/tx-link";
import type { MatchEvent } from "@/lib/blackout/match-store";
import { ticketLabel } from "@/lib/board/ticket-meta";
import { cn } from "@/lib/utils";

export interface EventLogProps {
  log: MatchEvent[];
  className?: string;
}

function describe(event: MatchEvent): { icon: typeof ShieldCheck; text: string; tone: string } {
  switch (event.type) {
    case "hidden_move":
      return {
        icon: ShieldCheck,
        text: `Round ${event.round} — Phantom moved by ${ticketLabel(event.ticket)} (proof verified)`,
        tone: "font-bold text-black",
      };
    case "public_move":
      return {
        icon: MapPin,
        text: `Round ${event.round} — ${event.player} moved to node ${event.to} (${ticketLabel(event.ticket)})`,
        tone: "text-fg-muted",
      };
    case "reveal":
      return {
        icon: Eye,
        text: `Round ${event.round} — Phantom revealed at node ${event.node}`,
        tone: "text-danger",
      };
    case "error":
      return { icon: AlertCircle, text: event.message, tone: "text-danger" };
  }
}

/** The chronological match log, most recent first. */
export function EventLog({ log, className }: EventLogProps) {
  if (log.length === 0) {
    return <p className={cn("text-sm text-fg-subtle", className)}>No events yet.</p>;
  }

  const rows = [...log].reverse();

  return (
    <ol className={cn("flex flex-col gap-1.5", className)}>
      {rows.map((event, i) => {
        const { icon: Icon, text, tone } = describe(event);
        return (
          <li key={`${event.at}-${i}`} className="flex items-start gap-2 text-xs">
            <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone)} />
            <span className="leading-relaxed text-fg-muted">
              {text}
              {"tx" in event ? (
                <>
                  {" "}
                  <TxLink tx={event.tx} />
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
