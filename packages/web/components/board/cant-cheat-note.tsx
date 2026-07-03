import { ExternalLink, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CantCheatNoteProps {
  explorerUrl: string;
  className?: string;
}

/**
 * The small, always-visible affordance explaining WHY the Phantom can't
 * cheat: it only ever sees public state plus its own secret position, and
 * every hidden move is a proof the on-chain verifier checks before the
 * referee accepts it — not a promise, a contract call.
 */
export function CantCheatNote({ explorerUrl, className }: CantCheatNoteProps) {
  return (
    <div className={cn("flex items-start gap-2.5 rounded-[var(--radius-md)] border-2 border-black bg-bg-panel px-4 py-3", className)}>
      <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-fg-subtle" />
      <p className="text-xs leading-relaxed text-fg-muted">
        The AI Phantom sees only public state and its own secret position — never yours. Every
        hidden move is a zero-knowledge proof the on-chain <code className="text-fg-subtle">move_along</code>{" "}
        verifier checks before the referee accepts it.{" "}
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-bold text-black underline decoration-accent decoration-[3px] underline-offset-2 hover:decoration-black"
        >
          Inspect the referee on stellar.expert
          <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </div>
  );
}
