import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { CityMapPreview } from "@/components/map/city-map-preview";
import { PrimitivesList } from "@/components/landing/primitives-list";
import { ProofFlow } from "@/components/landing/proof-flow";
import { ProvablyHiddenTag, VerifiedStamp } from "@/components/proof/verified-stamp";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { REFEREE_CONTRACT_EXPLORER_URL, REFEREE_CONTRACT_ID } from "@/lib/chain";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b-2 border-black bg-grain">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 15% 0%, oklch(30% 0.05 68 / 0.35), transparent 60%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="max-w-3xl motion-safe:animate-fade-up">
            <Badge variant="accent">Real-world ZK · Stellar testnet</Badge>
            <h1 className="mt-6 text-balance font-display text-[clamp(2.75rem,7vw,5.25rem)] font-bold leading-[1.02] tracking-tight text-fg">
              The AI can&rsquo;t cheat.
            </h1>
            <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-fg-muted">
              zkTable is a trustless privacy board-game arcade. Every hidden
              move, human or AI, is a zero-knowledge proof checked by a smart
              contract on Stellar. Not claimed. Checked.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/arcade"
                className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
              >
                Enter the arcade
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#evidence"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                Read the proof
              </a>
            </div>
            <p className="mt-8 font-mono text-xs uppercase tracking-[0.1em] text-fg-subtle">
              Noir circuits · Poseidon commitments · UltraHonk proofs verified
              via Stellar Protocol 25/26 host functions
            </p>
          </div>
        </div>
      </section>

      {/* Five primitives */}
      <section className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            Five primitives. Any board game.
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
            Every hidden-information board game reduces to the same five
            moves: hide a thing, randomize a thing, commit then reveal a
            thing, move a hidden thing legally, prove a hidden thing
            satisfies a rule. zkTable compiles each into a pre-built, audited
            Noir circuit. A developer composes them declaratively. Nobody
            writes a circuit.
          </p>
        </div>
        <div className="mt-12">
          <PrimitivesList />
        </div>
      </section>

      {/* Prove off-chain / verify on-chain */}
      <section className="border-y-2 border-black bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Prove off-chain. Verify on-chain.
            </h2>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
              You cannot run a proving machine inside a smart contract, it is
              too expensive. So the rule is fixed: proofs are built on the
              player&rsquo;s device, and only a verifier call ever touches
              the chain. The contract never sees a secret, only a proof that
              a secret-dependent move was legal.
            </p>
          </div>
          <div className="mt-12">
            <ProofFlow />
          </div>
        </div>
      </section>

      {/* Blackout teaser */}
      <section className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
          <div>
            <Badge variant="hidden">Flagship · board primitive</Badge>
            <h2 className="mt-6 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Blackout: a noir manhunt on a hidden graph
            </h2>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
              One Phantom moves across a 100-station transit city using
              taxi, bus, and rail tickets. A team of Investigators hunts
              them down. The Phantom&rsquo;s ticket type is announced every
              turn, that&rsquo;s the clue, but their destination is a{" "}
              <code className="rounded-[var(--radius-sm)] bg-bg-panel px-1.5 py-0.5 font-mono text-[0.85em] font-bold text-black">
                zk.hidden.node()
              </code>
              , proven legal at every move and surfaced only on rounds 3, 8,
              13, 18, and 24.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <ProvablyHiddenTag label="Phantom position" />
              <VerifiedStamp label="Every move verified" />
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/play/blackout"
                className={cn(buttonVariants({ variant: "primary", size: "md" }))}
              >
                Play vs AI
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/arcade"
                className={cn(buttonVariants({ variant: "ghost", size: "md" }))}
              >
                Browse the arcade
              </Link>
            </div>
          </div>
          <div className="relative aspect-square rounded-[var(--radius-lg)] border-2 border-black bg-bg-panel p-4">
            <CityMapPreview />
          </div>
        </div>
      </section>

      {/* Evidence */}
      <section id="evidence" className="border-t-2 border-black bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <h2 className="flex items-center gap-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
                <ShieldCheck className="h-8 w-8 font-bold text-black" aria-hidden />
                This isn&rsquo;t a mockup.
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
                The generic referee contract below is live on Stellar
                testnet right now, verifying UltraHonk proofs with Poseidon
                commitments through the Protocol 25/26 host functions. It
                is the same contract the arcade calls. Check it yourself.
              </p>
            </div>
            <a
              href={REFEREE_CONTRACT_EXPLORER_URL}
              target="_blank"
              rel="noreferrer"
              className="group flex shrink-0 flex-col gap-2 rounded-[var(--radius-lg)] border-2 border-black bg-bg-panel px-6 py-5 transition-colors hover:bg-accent-soft"
            >
              <span className="font-mono text-xs uppercase tracking-[0.1em] text-fg-subtle">
                referee contract · testnet
              </span>
              <span className="break-all font-mono text-sm text-fg group-hover:text-black">
                {REFEREE_CONTRACT_ID}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-black">
                view on stellar.expert
                <ArrowRight className="h-3 w-3" />
              </span>
            </a>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-6 py-24 text-center sm:py-28">
        <h2 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Three games. One SDK. Zero trust required.
        </h2>
        <div className="mt-10">
          <Link
            href="/arcade"
            className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
          >
            Enter the arcade
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
