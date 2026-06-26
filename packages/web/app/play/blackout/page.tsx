import { ArrowLeft, Hammer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CityMapPreview } from "@/components/map/city-map-preview";
import { ProvablyHiddenTag } from "@/components/proof/verified-stamp";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Blackout — zkTable",
  description: "The interactive board is coming online.",
};

/**
 * Placeholder for the interactive Blackout board. The full board (pawns,
 * ticket feed, possible-locations shadow, proof-status indicator, reveal
 * animation) is a separate milestone (M4c) against a game API (M4b). This
 * route intentionally ships no game logic, contract calls, or proving —
 * only the map preview and a honest "not yet" state.
 */
export default function BlackoutPlaceholderPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16 text-center sm:py-24">
      <Link
        href="/arcade"
        className="inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to arcade
      </Link>

      <div className="mt-8 flex justify-center">
        <div className="relative aspect-square w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-bg-panel p-6">
          <CityMapPreview />
          <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-lg)] bg-bg-overlay/70 backdrop-blur-[1px]">
            <Hammer className="h-8 w-8 text-fg-subtle" aria-hidden />
          </div>
        </div>
      </div>

      <div className="mt-8 flex justify-center gap-2">
        <Badge variant="hidden">board primitive</Badge>
        <ProvablyHiddenTag label="Phantom position" />
      </div>

      <h1 className="mt-6 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
        The board is coming online
      </h1>
      <p className="mx-auto mt-4 max-w-lg text-[0.95rem] leading-relaxed text-fg-muted">
        The game engine, the AI opponents, and the live proof pipeline are
        built and verified on testnet already. What&rsquo;s left is wiring
        this route to them: pawns on the map, the ticket feed, the
        shrinking possible-locations shadow, and a proof-status indicator
        for every move. Honest state, no mock board.
      </p>

      <div className="mt-10">
        <Link
          href="/arcade"
          className={cn(buttonVariants({ variant: "outline", size: "md" }))}
        >
          Explore the rest of the arcade
        </Link>
      </div>
    </div>
  );
}
