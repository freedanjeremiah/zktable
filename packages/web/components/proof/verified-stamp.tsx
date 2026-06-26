import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The recurring "this was cryptographically checked" affordance. Two faces:
 *   - `verified`: a rotated brass stamp, like a case file closed with a seal.
 *   - `hidden`: the cold-slate twin, for state that stays provably secret.
 * Reused wherever the app wants the ZK boundary to be *felt*, not just
 * mentioned — landing strip, game cards, and later the board's proof status.
 */
export function VerifiedStamp({
  label = "Verified on-chain",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex -rotate-2 items-center gap-1.5 rounded-[var(--radius-sm)] border-2 border-accent/70 px-2.5 py-1 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-accent",
        className,
      )}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
      {label}
    </span>
  );
}

export function ProvablyHiddenTag({
  label = "Provably hidden",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-hidden/50 bg-hidden/10 px-2.5 py-1 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-hidden-strong",
        className,
      )}
    >
      <Lock className="h-3 w-3" strokeWidth={2.5} />
      {label}
    </span>
  );
}
