"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Honest progress for a real testnet deploy (~1-2 min: verifier + referee
 * contract deploys, N `join` calls, a hidden-start commitment). No fake
 * percentage bar — just a real elapsed-time counter and the typical step
 * order, labeled as typical (the server doesn't stream granular progress
 * back yet), so nothing here claims more precision than it has.
 */
const STEPS = [
  "Computing the transit graph's Merkle root…",
  "Deploying the move_along verifier contract…",
  "Deploying the trustless referee contract…",
  "Joining the Phantom and Investigator seats…",
  "Committing the Phantom's hidden start position…",
  "Starting the match…",
] as const;

export interface CreateProgressProps {
  label: string;
  startedAt: number;
}

export function CreateProgress({ label, startedAt }: CreateProgressProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const seconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  // Purely cosmetic pacing through the typical step list — not a real
  // progress signal (the API resolves once, at the end, with no
  // intermediate events). Advances roughly every 12s so it doesn't imply
  // false precision, and stalls on the last step if it runs long.
  const stepIndex = Math.min(STEPS.length - 1, Math.floor(seconds / 12));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="font-mono text-2xl text-fg">{mm}:{ss}</p>
        <p className="text-sm text-fg-muted">{STEPS[stepIndex]}</p>
        <p className="text-xs text-fg-subtle">
          Real contract deploys on Stellar testnet, typically 1-2 minutes. This is elapsed time,
          not a progress estimate — the server doesn&rsquo;t stream step-by-step status yet.
        </p>
      </CardContent>
    </Card>
  );
}
