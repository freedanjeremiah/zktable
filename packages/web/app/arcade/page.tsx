import { ArrowRight, Dice5, Layers, Skull } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CityMapPreview } from "@/components/map/city-map-preview";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Arcade — zkTable",
  description: "Three trustless privacy board games, one ZK SDK.",
};

const PLAYABLE_GAMES = [
  {
    slug: "liars-dice",
    name: "Liar's Dice",
    tagline: "Bluff over hidden rolls",
    description:
      "Five hidden dice per player, an escalating public bid, and a challenge that forces a reveal. The roll is provably fair before anyone calls the bluff.",
    primitives: ["dice", "sealed"],
    icon: Dice5,
  },
  {
    slug: "coup-lite",
    name: "Coup-lite",
    tagline: "Bluff a hidden hand",
    description:
      "A hidden two-card hand from a shuffled court deck. Claim a character's power, get challenged, and the proof, not your poker face, settles it.",
    primitives: ["deck", "sealed"],
    icon: Skull,
  },
] as const;

export default function ArcadePage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="max-w-2xl">
        <h1 className="font-display text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          The arcade
        </h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
          Three visibly different games, one composable ZK SDK underneath.
          Every card below states exactly which primitive is on trial.
        </p>
      </div>

      {/* Featured: Blackout */}
      <div className="mt-14 overflow-hidden rounded-[var(--radius-lg)] border-2 border-black bg-bg-elevated shadow-[var(--shadow-brutal-lg)]">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col justify-between p-8 sm:p-10">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent">Flagship</Badge>
                <Badge variant="hidden">board primitive</Badge>
                <Badge variant="outline">tickets · resource</Badge>
              </div>
              <h2 className="mt-5 font-display text-3xl font-bold tracking-tight text-fg">
                Blackout
              </h2>
              <p className="mt-3 max-w-md text-[0.95rem] leading-relaxed text-fg-muted">
                A hidden Phantom crosses a 100-station transit city while a
                team of Investigators hunts them down. Hidden movement, not
                a hidden hand, proven legal on every single move.
              </p>
              <dl className="mt-6 grid grid-cols-3 gap-4 border-t-2 border-black pt-6 text-sm">
                <div>
                  <dt className="text-fg-subtle">Players</dt>
                  <dd className="mt-1 font-mono text-fg">1 vs up to 5</dd>
                </div>
                <div>
                  <dt className="text-fg-subtle">Rounds</dt>
                  <dd className="mt-1 font-mono text-fg">24</dd>
                </div>
                <div>
                  <dt className="text-fg-subtle">Reveals</dt>
                  <dd className="mt-1 font-mono text-fg">3·8·13·18·24</dd>
                </div>
              </dl>
            </div>
            <div className="mt-8">
              <Link
                href="/play/blackout"
                className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
              >
                Play vs AI
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="relative min-h-[280px] border-t-2 border-black bg-bg-panel p-6 lg:border-l lg:border-t-0">
            <CityMapPreview />
          </div>
        </div>
      </div>

      {/* Also playable */}
      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {PLAYABLE_GAMES.map((game) => (
          <div
            key={game.slug}
            className="flex flex-col justify-between rounded-[var(--radius-lg)] border-2 border-black bg-bg-elevated p-8 shadow-[var(--shadow-brutal)] transition-shadow hover:shadow-[var(--shadow-brutal-lg)]"
          >
            <div>
              <div className="flex items-center justify-between">
                <game.icon className="h-6 w-6 text-fg-subtle" aria-hidden />
                <Badge variant="accent">Playable</Badge>
              </div>
              <h3 className="mt-4 font-display text-2xl font-bold tracking-tight text-fg">
                {game.name}
              </h3>
              <p className="mt-1 text-sm text-fg-subtle">{game.tagline}</p>
              <p className="mt-3 text-[0.9rem] leading-relaxed text-fg-muted">
                {game.description}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {game.primitives.map((p) => (
                  <Badge key={p} variant="hidden">
                    <Layers className="h-3 w-3" />
                    zk.{p}
                  </Badge>
                ))}
              </div>
            </div>
            <Link
              href={`/play/${game.slug}`}
              className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-8 w-full")}
            >
              Play vs AI
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
