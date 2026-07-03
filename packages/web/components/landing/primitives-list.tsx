import { Badge } from "@/components/ui/badge";

// The five ZK types the SDK ships — each backed by a real Noir circuit (or
// an on-chain commit-reveal protocol) that has verified proofs on live
// Stellar testnet. A game developer composes these; they never write one.
const ZK_TYPES = [
  {
    id: "01",
    name: "board",
    tag: "hidden movement",
    circuits: ["move_along"],
    provedBy: "Blackout",
    body: "A piece moves from a hidden position to a new hidden position along a legal edge of a public graph, and neither position is ever revealed.",
  },
  {
    id: "02",
    name: "hidden",
    tag: "secret state",
    circuits: ["Poseidon2 commitments"],
    provedBy: "every hidden value",
    body: "A move is legal for a hidden value, without the value itself ever leaving the player's device.",
  },
  {
    id: "03",
    name: "dice",
    tag: "verifiable randomness",
    circuits: ["dice_valid"],
    provedBy: "Liar's Dice",
    body: "A roll is unpredictable, unbiased, and matches a commitment every participant locked in before anyone could see it — fairness proven in-circuit.",
  },
  {
    id: "04",
    name: "deck",
    tag: "shuffle & deal",
    circuits: ["valid_shuffle", "card_membership"],
    provedBy: "Coup-lite",
    body: "The whole deck is provably the canonical card set in a seed-forced order — the dealer cannot stack it — and a player can prove they hold a claimed card without showing their hand.",
  },
  {
    id: "05",
    name: "sealed",
    tag: "simultaneous commit",
    circuits: ["commit-reveal, referee-enforced"],
    provedBy: "dice + deck seeds",
    body: "Every player commits before anyone reveals, so nobody can act on knowledge of someone else's hidden move.",
  },
] as const;

export function PrimitivesList() {
  return (
    <ol className="divide-y-2 divide-black border-y-2 border-black">
      {ZK_TYPES.map((p) => (
        <li
          key={p.id}
          className="grid grid-cols-[3rem_1fr] gap-x-4 gap-y-2 py-6 sm:grid-cols-[4rem_11rem_1fr] sm:gap-x-8"
        >
          <span className="font-mono text-sm text-fg-subtle">{p.id}</span>
          <div className="flex flex-col gap-2">
            <span className="font-display text-lg font-extrabold text-fg">
              zk.{p.name}
            </span>
            <span className="text-xs text-fg-subtle">{p.tag}</span>
          </div>
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <p className="text-[0.95rem] leading-relaxed text-fg-muted">{p.body}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="accent">live on testnet</Badge>
              {p.circuits.map((c) => (
                <Badge key={c} variant="hidden" className="normal-case">
                  {c}
                </Badge>
              ))}
              <span className="text-xs text-fg-subtle">proven by {p.provedBy}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
