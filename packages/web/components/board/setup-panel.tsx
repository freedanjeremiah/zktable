"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProvablyHiddenTag } from "@/components/proof/verified-stamp";

export interface SetupOptions {
  investigators: number;
  model: string;
  /** Which side the human plays. 'phantom' proves every move in YOUR browser (M8.5). */
  seat: "investigator" | "phantom";
}

export interface SetupPanelProps {
  onStart: (options: SetupOptions) => void;
  disabled?: boolean;
}

const MIN_INVESTIGATORS = 2;
const MAX_INVESTIGATORS = 5;

/**
 * Pre-game panel: pick the investigator count (you play the first seat; the
 * rest are AI) and, optionally, an AI model override. "Deploy match" kicks
 * off a REAL testnet deploy — the caller shows honest, slow progress next.
 */
export function SetupPanel({ onStart, disabled }: SetupPanelProps) {
  const [investigators, setInvestigators] = useState(3);
  const [model, setModel] = useState("");
  const [seat, setSeat] = useState<"investigator" | "phantom">("investigator");

  return (
    <Card>
      <CardHeader>
        <CardTitle>New match</CardTitle>
        <CardDescription>
          {seat === "investigator"
            ? "You play the first Investigator seat. The Phantom and the rest of the Investigators are AI, each move a real proof verified on Stellar testnet."
            : "You play the Phantom: your position never leaves this browser — every hidden move is proven HERE with bb.js and only the proof goes on-chain."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            Your seat
          </label>
          <div className="mt-2 flex gap-2">
            {(["investigator", "phantom"] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={disabled}
                onClick={() => setSeat(option)}
                className={
                  "h-9 flex-1 rounded-[var(--radius-sm)] border px-3 text-sm capitalize transition-colors disabled:pointer-events-none disabled:opacity-40 " +
                  (seat === option
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border-strong text-fg-muted hover:border-accent hover:text-accent")
                }
              >
                {option === "phantom" ? "Phantom (prove in-browser)" : "Investigator"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            {seat === "investigator" ? "Investigators (you + AI)" : "AI investigators hunting you"}
          </label>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer investigators"
              disabled={disabled || investigators <= MIN_INVESTIGATORS}
              onClick={() => setInvestigators((n) => Math.max(MIN_INVESTIGATORS, n - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-border-strong text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-6 text-center font-mono text-lg text-fg">{investigators}</span>
            <button
              type="button"
              aria-label="More investigators"
              disabled={disabled || investigators >= MAX_INVESTIGATORS}
              onClick={() => setInvestigators((n) => Math.min(MAX_INVESTIGATORS, n + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-border-strong text-fg-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs text-fg-subtle">
              {seat === "investigator"
                ? `you + ${investigators - 1} AI investigator${investigators - 1 === 1 ? "" : "s"}`
                : `${investigators} AI investigator${investigators === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="ai-model" className="text-xs font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            AI model (optional)
          </label>
          <input
            id="ai-model"
            type="text"
            value={model}
            disabled={disabled}
            onChange={(e) => setModel(e.target.value)}
            placeholder="server default"
            className="mt-2 h-9 w-full rounded-[var(--radius-sm)] border border-border-strong bg-bg-elevated px-3 font-mono text-sm text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
          <ProvablyHiddenTag label="Phantom start position" />
          <Button
            variant="primary"
            size="lg"
            disabled={disabled}
            onClick={() => onStart({ investigators, model: model.trim(), seat })}
          >
            Deploy a real match
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
