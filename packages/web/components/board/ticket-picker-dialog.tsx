"use client";

import { Bus, Car, TrainFront } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { ticketLabel } from "@/lib/board/ticket-meta";
import type { Ticket } from "@/lib/board/ticket-meta";
import type { MatchDtoPlayer } from "@/lib/blackout/dto";
import { cn } from "@/lib/utils";

const TICKET_ICONS = { 0: Car, 1: Bus, 2: TrainFront } as const;
const TICKET_KEY = { 0: "taxi", 1: "bus", 2: "rail" } as const;

export interface TicketPickerDialogProps {
  open: boolean;
  node: number | null;
  tickets: Ticket[];
  humanPlayer: MatchDtoPlayer | null;
  onPick: (ticket: Ticket) => void;
  onOpenChange: (open: boolean) => void;
}

/** Shown only when a clicked destination is reachable by more than one ticket type. */
export function TicketPickerDialog({ open, node, tickets, humanPlayer, onPick, onOpenChange }: TicketPickerDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={node !== null ? `Move to node ${node}` : "Choose a ticket"}
      description="This route is reachable by more than one ticket type — pick which to spend."
    >
      <div className="flex flex-col gap-2">
        {tickets.map((t) => {
          const Icon = TICKET_ICONS[t];
          const remaining = humanPlayer?.tickets[TICKET_KEY[t]] ?? 0;
          return (
            <button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              disabled={remaining <= 0}
              className={cn(
                buttonVariants({ variant: "outline", size: "md" }),
                "justify-between",
              )}
            >
              <span className="inline-flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {ticketLabel(t)}
              </span>
              <span className="font-mono text-xs text-fg-subtle">{remaining} left</span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
