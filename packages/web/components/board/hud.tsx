import { Car, TrainFront, Bus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MatchDtoPlayer } from "@/lib/blackout/dto";
import { DEFAULT_N_ROUNDS, DEFAULT_REVEAL_ROUNDS } from "@/lib/board/ticket-meta";
import { cn } from "@/lib/utils";

export interface HudProps {
  round: number;
  humanPlayer: MatchDtoPlayer | null;
  turnLabel: string;
  className?: string;
}

const TICKET_ICONS = { taxi: Car, bus: Bus, rail: TrainFront } as const;

/** Round counter, whose turn it is, and the human's own ticket wallet. */
export function Hud({ round, humanPlayer, turnLabel, className }: HudProps) {
  const nextReveal = DEFAULT_REVEAL_ROUNDS.find((r) => r >= round);

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-4", className)}>
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="font-mono">
          Round {round} / {DEFAULT_N_ROUNDS}
        </Badge>
        {nextReveal ? (
          <span className="text-xs text-fg-subtle">
            next reveal: round {nextReveal}
          </span>
        ) : null}
        <span className="text-sm text-fg">{turnLabel}</span>
      </div>

      {humanPlayer ? (
        <div className="flex items-center gap-3">
          {(["taxi", "bus", "rail"] as const).map((k) => {
            const Icon = TICKET_ICONS[k];
            return (
              <span key={k} className="inline-flex items-center gap-1 font-mono text-xs text-fg-muted">
                <Icon className="h-3.5 w-3.5" />
                {humanPlayer.tickets[k]}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
