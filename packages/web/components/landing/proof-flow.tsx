import { ArrowRight } from "lucide-react";
import { VerifiedStamp } from "@/components/proof/verified-stamp";

const OFF_CHAIN_STEPS = [
  "Holds the secret (a position, a hand, a roll)",
  "Chooses a move",
  "Builds a witness from the secret + the move",
  "Generates a zero-knowledge proof",
];

const ON_CHAIN_STEPS = [
  "Receives the proof and its public inputs",
  "Checks it against the circuit's verification key",
  "Applies the move and advances the turn on success",
  "Rejects the transaction outright on failure",
];

export function ProofFlow() {
  return (
    <div className="grid gap-8 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-6">
      <div className="rounded-[var(--radius-lg)] border-2 border-black bg-hidden/[0.04] p-6">
        <p className="font-mono text-xs uppercase tracking-[0.12em] font-bold text-black">
          Off-chain — player or AI
        </p>
        <ol className="mt-4 space-y-3">
          {OFF_CHAIN_STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm text-fg-muted">
              <span className="font-mono text-fg-subtle">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div className="flex items-center justify-center gap-2 text-fg-subtle sm:flex-col">
        <ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" aria-hidden />
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em]">
          submit tx
        </span>
      </div>

      <div className="rounded-[var(--radius-lg)] border-2 border-black bg-accent/[0.04] p-6">
        <p className="font-mono text-xs uppercase tracking-[0.12em] font-bold text-black">
          On-chain — Soroban referee
        </p>
        <ol className="mt-4 space-y-3">
          {ON_CHAIN_STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm text-fg-muted">
              <span className="font-mono text-fg-subtle">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <VerifiedStamp className="mt-5" />
      </div>
    </div>
  );
}
