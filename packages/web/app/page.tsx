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

const REPO_URL = "https://github.com/freedanjeremiah/zktable";
const TUTORIAL_URL = `${REPO_URL}/blob/main/docs/tutorial-build-a-game.md`;

const DEFINE_GAME_SNIPPET = `const game = defineGame({
  name: 'my-game',
  players: { min: 2, max: 4 },
  components: {
    board: zk.board(cityGraph),     // hidden movement
    dice:  zk.dice.pool({ sides: 6 }),
    deck:  zk.deck.of(cards),       // provably-fair shuffle
  },
  state:  { public: (ctx) => ({ /* … */ }), secret: (ctx) => ({ /* … */ }) },
  turn:   { order: 'clockwise', moves: { /* your rules */ } },
  end:    (state) => outcome,
})
// That's the whole job. Circuits, proofs, the on-chain
// referee, and cheat-proof AI opponents are derived.`;

export default function LandingPage() {
  return (
    <>
      {/* Hero — the SDK pitch */}
      <section className="relative overflow-hidden border-b-2 border-black bg-grain">
        <div className="relative mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <div className="max-w-3xl motion-safe:animate-fade-up">
            <Badge variant="accent">A TypeScript SDK · Stellar testnet</Badge>
            <h1 className="mt-6 text-balance font-display text-[clamp(2.5rem,6.5vw,4.75rem)] font-bold leading-[1.02] tracking-tight text-fg">
              Declare a game.
              <br />
              The ZK is handled.
            </h1>
            <p className="mt-6 max-w-xl text-balance text-lg leading-relaxed text-fg-muted">
              zkTable is a TypeScript SDK for building trustless,
              privacy-preserving board games on Stellar. You bring an idea and
              design the on-chain activity — zero-knowledge privacy, on-chain
              state, and AI opponents come free. Nobody writes a circuit.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a
                href={TUTORIAL_URL}
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
              >
                Build a game
                <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                href="/arcade"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
              >
                See it live
              </Link>
            </div>
            <p className="mt-8 font-mono text-xs uppercase tracking-[0.1em] text-fg-subtle">
              Noir circuits · Poseidon commitments · UltraHonk proofs verified
              via Stellar Protocol 25/26 host functions
            </p>
          </div>
        </div>
      </section>

      {/* ZK types supported */}
      <section className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <Badge variant="hidden">ZK types supported</Badge>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            Five ZK primitives. Any board game.
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
            Every hidden-information board game reduces to the same five
            moves: hide a thing, randomize a thing, commit then reveal a
            thing, move a hidden thing legally, prove a hidden thing
            satisfies a rule. zkTable ships each as a pre-built, tested Noir
            circuit with a matching on-chain verifier — all five already
            proving on live testnet. You compose them declaratively.
          </p>
        </div>
        <div className="mt-12">
          <PrimitivesList />
        </div>
      </section>

      {/* Developer experience: defineGame */}
      <section className="border-y-2 border-black bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
            <div>
              <Badge variant="accent">Developer experience</Badge>
              <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
                One declarative object. Everything else is derived.
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
                An ordinary game definition — players, state, moves, an end
                condition — is the whole authoring surface. The SDK binds
                your hidden state to the right circuits, deploys the generic
                referee contract, keeps a local engine in lockstep with the
                chain, and seats AI opponents that pass through the exact
                same proof boundary as humans.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href={TUTORIAL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "primary", size: "md" }))}
                >
                  Read the tutorial
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href={REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(buttonVariants({ variant: "ghost", size: "md" }))}
                >
                  Browse the SDK
                </a>
              </div>
            </div>
            <pre className="overflow-x-auto rounded-[var(--radius-lg)] border-2 border-black bg-white p-6 font-mono text-[0.8rem] leading-relaxed text-fg shadow-[var(--shadow-brutal)]">
              <code>{DEFINE_GAME_SNIPPET}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* Prove off-chain / verify on-chain */}
      <section className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            Prove off-chain. Verify on-chain.
          </h2>
          <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
            You cannot run a proving machine inside a smart contract, it is
            too expensive. So the rule is fixed: proofs are built on the
            player&rsquo;s device, and only a verifier call ever touches the
            chain. The contract never sees a secret, only a proof that a
            secret-dependent move was legal — and every one of those calls
            is a public transaction you can open on the explorer.
          </p>
        </div>
        <div className="mt-12">
          <ProofFlow />
        </div>
      </section>

      {/* The arcade = proof the SDK is real */}
      <section className="border-y-2 border-black bg-bg-elevated">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
            <div>
              <Badge variant="hidden">Built on zkTable</Badge>
              <h2 className="mt-6 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
                Three very different games prove the SDK is real
              </h2>
              <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
                Blackout (hidden pursuit on a 100-station transit graph),
                Liar&rsquo;s Dice (provably-fair hidden rolls), and Coup-lite
                (a shuffle nobody can stack) each exercise a different ZK
                type — and each runs full matches on live testnet. Their AI
                opponents see only a{" "}
                <code className="rounded-[var(--radius-sm)] bg-bg-panel px-1.5 py-0.5 font-mono text-[0.85em] font-bold text-black">
                  PlayerView
                </code>{" "}
                — public state plus their own secret — so they structurally
                cannot cheat. Neither can yours.
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                <ProvablyHiddenTag label="Hidden state" />
                <VerifiedStamp label="Every move verified" />
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <Link
                  href="/arcade"
                  className={cn(buttonVariants({ variant: "primary", size: "md" }))}
                >
                  Enter the arcade
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="relative aspect-square rounded-[var(--radius-lg)] border-2 border-black bg-bg-panel p-4 shadow-[var(--shadow-brutal)]">
              <CityMapPreview />
            </div>
          </div>
        </div>
      </section>

      {/* Evidence */}
      <section id="evidence" className="mx-auto max-w-6xl px-6 py-24 sm:py-28">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 className="flex items-center gap-3 font-display text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              <ShieldCheck className="h-8 w-8 font-bold text-black" aria-hidden />
              This isn&rsquo;t a mockup.
            </h2>
            <p className="mt-4 text-[0.95rem] leading-relaxed text-fg-muted">
              The generic referee contract below is live on Stellar testnet
              right now, verifying UltraHonk proofs with Poseidon commitments
              through the Protocol 25/26 host functions. It is the same
              contract the arcade calls — and in every game, each on-chain
              action links straight to its transaction on the explorer.
            </p>
          </div>
          <a
            href={REFEREE_CONTRACT_EXPLORER_URL}
            target="_blank"
            rel="noreferrer"
            className="group flex shrink-0 flex-col gap-2 rounded-[var(--radius-lg)] border-2 border-black bg-bg-panel px-6 py-5 shadow-[var(--shadow-brutal)] transition-colors hover:bg-accent-soft"
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
      </section>

      {/* Final CTA */}
      <section className="border-t-2 border-black bg-accent">
        <div className="mx-auto max-w-6xl px-6 py-24 text-center sm:py-28">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-black sm:text-4xl">
            Your game idea + our ZK. Zero trust required.
          </h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href={TUTORIAL_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              Build a game
              <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              href="/arcade"
              className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "text-black")}
            >
              Play the arcade
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
