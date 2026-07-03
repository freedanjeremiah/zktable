"use client";

import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { ProvablyHiddenTag, VerifiedStamp } from "@/components/proof/verified-stamp";
import type { ProofStatus } from "@/lib/blackout/match-store";
import { cn } from "@/lib/utils";

export type ProofPhase = "idle" | "proving" | "verified" | "error";

export interface ProofStatusCardProps {
  phase: ProofPhase;
  proofStatus: ProofStatus | null;
  explorerUrl: string;
  className?: string;
}

/**
 * The "make the ZK felt" moment. The Phantom's every hidden move is a real
 * UltraHonk proof, verified by the on-chain verifier contract before the
 * referee accepts it — this is where that fact gets a satisfying, legible
 * beat instead of vanishing into a network request.
 */
export function ProofStatusCard({ phase, proofStatus, explorerUrl, className }: ProofStatusCardProps) {
  if (phase === "proving") {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-[var(--radius-md)] border border-hidden/40 bg-hidden/10 px-4 py-3",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-hidden-strong" />
        <div>
          <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-hidden-strong">
            Phantom is moving in the dark
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Generating a real UltraHonk proof that the move is legal on the graph — the
            destination stays secret; only the proof and a new commitment reach the chain.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "verified" && proofStatus?.ok) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-[var(--radius-md)] border border-accent/40 bg-accent/10 px-4 py-3",
          className,
        )}
      >
        <VerifiedStamp label="Hidden move verified" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-fg-muted">
            Round {proofStatus.round} — the referee checked the proof against the graph root and
            the Phantom&rsquo;s stored commitment before accepting it. Nobody, including this app,
            saw the destination.
          </p>
          {proofStatus.cNew ? (
            <p className="mt-1 truncate font-mono text-[0.6875rem] text-fg-subtle">
              new commitment {proofStatus.cNew.slice(0, 10)}…{proofStatus.cNew.slice(-6)}
            </p>
          ) : null}
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Verify the referee on stellar.expert
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  if (phase === "error" && proofStatus && !proofStatus.ok) {
    return (
      <div
        className={cn(
          "flex items-start gap-3 rounded-[var(--radius-md)] border border-danger/40 bg-danger/10 px-4 py-3",
          className,
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
        <div>
          <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-danger">
            Proof rejected
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">{proofStatus.error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 rounded-[var(--radius-md)] border border-border px-4 py-3", className)}>
      <ProvablyHiddenTag label="Phantom position" />
      <p className="text-xs text-fg-subtle">Secret until the next reveal round.</p>
    </div>
  );
}
