const PRIMITIVES = [
  {
    id: "01",
    name: "board",
    tag: "hidden movement",
    body: "A piece moves from a hidden position to a new hidden position along a legal edge of a public graph, and neither position is ever revealed.",
  },
  {
    id: "02",
    name: "hidden",
    tag: "secret state",
    body: "A move is legal for a hidden value, without the value itself ever leaving the player's device.",
  },
  {
    id: "03",
    name: "dice",
    tag: "verifiable randomness",
    body: "A roll is unpredictable, unbiased, and matches a commitment every participant locked in before anyone could see it.",
  },
  {
    id: "04",
    name: "deck",
    tag: "shuffle & deal",
    body: "Every player receives a distinct card from a valid shuffle, and nobody, not even the dealer, got to peek first.",
  },
  {
    id: "05",
    name: "sealed",
    tag: "simultaneous commit",
    body: "Every player commits before anyone reveals, so nobody can act on knowledge of someone else's hidden move.",
  },
] as const;

export function PrimitivesList() {
  return (
    <ol className="divide-y divide-border border-y border-border">
      {PRIMITIVES.map((p) => (
        <li
          key={p.id}
          className="grid grid-cols-[3rem_1fr] gap-x-4 gap-y-2 py-6 sm:grid-cols-[4rem_10rem_1fr] sm:items-baseline sm:gap-x-8"
        >
          <span className="font-mono text-sm text-fg-subtle">{p.id}</span>
          <span className="font-display text-lg font-semibold text-fg">
            zk.{p.name}
          </span>
          <p className="col-span-2 text-[0.95rem] leading-relaxed text-fg-muted sm:col-span-1">
            {p.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
