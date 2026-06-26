# @zktable/web

The zkTable arcade web shell: landing page, arcade lobby, and Freighter wallet
connect. Next.js (App Router) + TypeScript + Tailwind v4 + hand-authored
shadcn-style primitives.

This package is the **shell** built in milestone M4a. It intentionally ships
no game logic, no proving, and no contract calls — see
[Scope](#scope--seams-for-m4b--m4c) below.

## Run it

```bash
pnpm --filter @zktable/web dev       # http://localhost:3000
pnpm --filter @zktable/web build     # production build
pnpm --filter @zktable/web start     # serve the production build
pnpm --filter @zktable/web lint
pnpm --filter @zktable/web typecheck
```

No environment variables are required to run the shell. The board route
(`/play/blackout`) will need a backend once M4b ships an API and M4c wires up
the interactive board.

## Design intent

**Aesthetic: "noir case-file."** The scene: a detective reviewing a case file
under a desk lamp at 1am, the city dark outside. The file itself is precise
and typed, not romantic — that's the tone for a *cryptography* product, not a
neon cyberpunk one. Two accents carry all the meaning in the palette:

- **brass / amber** ("verified") — proofs that closed, moves that landed,
  primary actions. The stamp ink.
- **cold slate** ("hidden") — anything `zk.hidden` — secret positions,
  proving-in-progress, fog.

Every neutral is a warm-tinted OKLCH charcoal, never pure black. Typography
pairs **Archivo** (display/UI, bold weight contrast) with **Source Serif 4**
(body prose, dossier authority) and **JetBrains Mono** (addresses, hashes,
badges — functional, not decorative). Deliberately avoided: gradient text,
glassmorphism, side-stripe card borders, italic display-serif "editorial"
headlines, and the neon-on-black crypto reflex.

The through-line — "the AI can't cheat, verified on-chain" — is made literal
with two recurring components: `<VerifiedStamp />` (a rotated brass stamp,
`components/proof/verified-stamp.tsx`) and `<ProvablyHiddenTag />` (the cold
twin for secret state). Both are used on the landing page's proof-flow strip
and the Blackout teaser, and are designed to be reused by the real board's
proof-status indicator in M4c.

Tailwind v4's CSS-first config carries all design tokens as OKLCH custom
properties in `app/globals.css` (`@theme` block) — there is no
`tailwind.config.js`; that file is a legacy-era artifact v4 no longer needs.
Reduced-motion is respected in two layers: a global CSS override plus
`motion-safe:` variants on the few decorative animations (map pulse, hero
fade-up).

## Routes

| Route | Status |
|---|---|
| `/` | Landing page: hero, five-primitive explainer, prove-off-chain/verify-on-chain strip, Blackout teaser, live testnet contract evidence link, final CTA. |
| `/arcade` | Lobby: featured Blackout card ("Play vs AI" → `/play/blackout`) plus Liar's Dice and Coup-lite "coming soon" cards, each stating its ZK primitive. |
| `/play/blackout` | Honest placeholder — map preview + "the board is coming online." No game logic. |

## Wallet connect

`lib/wallet/freighter-adapter.ts` is a thin adapter over
`@stellar/freighter-api` (a real, tiny — ~12KB — dependency; no fallback was
needed). Freighter's raw functions never reject; they resolve to
`{ ...payload, error?: FreighterApiError }`, which is easy to forget to
check. The adapter normalizes that into throw-on-failure functions with
messages written for a player, not a debugger.

One non-obvious wrinkle worth documenting: Freighter talks to the page over
`window.postMessage`. Its own `isConnected`/`getAddress` calls have a
built-in 2s internal timeout when nothing answers, but `isAllowed`,
`getNetworkDetails`, and critically `requestAccess` do not — with no
extension installed (or a stalled extension), those would hang forever with
no way for the UI to surface an error. Every adapter call is wrapped in its
own timeout (`withTimeout`) so "not installed" / "not responding" always
resolves to a friendly error instead of an infinite "Connecting…" spinner.

`lib/wallet/wallet-context.tsx` exposes a `WalletProvider` + `useWallet()`
hook (client-side, wraps the whole app in `app/layout.tsx`):

```ts
interface WalletContextValue {
  status: "checking" | "not-installed" | "disconnected" | "connecting" | "connected" | "error";
  address: string | null;
  network: string | null;
  isTestnet: boolean;
  error: string | null;
  connect: () => Promise<void>;       // opens Freighter's connect popup
  disconnect: () => void;              // forgets the address locally
  fundFromFriendbot: () => Promise<void>;
  isFunding: boolean;
}
```

On mount, the provider silently checks for an already-granted session
(no popup) so a returning player doesn't have to reconnect every load.
`connect()` is the only path that ever triggers Freighter's popup. The app
is testnet-only throughout — `isTestnet` gates a friendly "switch network"
nudge in the wallet dialog rather than blocking outright.

`components/wallet/wallet-button.tsx` is the header's client-side
integration: it renders a different affordance per status (checking →
skeleton, not-installed → "Install Freighter" link, disconnected →
"Connect Wallet", connected → address chip that opens a dialog with copy,
network badge, "Fund from Friendbot", and "forget session").

## Scope / seams for M4b + M4c

This package ships **no** game logic, no proof generation, and no contract
calls. `/play/blackout` is a placeholder by design — M4c replaces its body
with the interactive board (pawns, ticket feed, possible-locations shadow,
proof-status indicator, reveal animation) against an API M4b adds under
`app/api/`.

What M4c/M4b can reuse from this shell:

- **Layout**: `<Header />` / `<Footer />` (`components/layout/`) already wrap
  every route via `app/layout.tsx`; new routes under `app/` inherit them for
  free.
- **Design system**: `components/ui/{button,card,badge,dialog}.tsx` — small,
  shadcn-flavored primitives (`cva` variants, `cn()` merge helper in
  `lib/utils.ts`). All tokens are CSS variables in `app/globals.css`
  (`--color-accent`, `--color-hidden`, `--radius-*`, `--font-*`), so new
  components inherit the palette by using the same Tailwind utility names
  (`bg-accent`, `text-hidden-strong`, `rounded-[var(--radius-md)]`, etc.)
  rather than hardcoding colors.
- **Proof affordances**: `<VerifiedStamp />` / `<ProvablyHiddenTag />`
  (`components/proof/verified-stamp.tsx`) are built to be reused by the
  board's live proof-status indicator ("proving… → verified on-chain ✓").
- **Wallet**: `useWallet()` gives the board an already-connected `address`
  and network state; it does not yet expose `signTransaction` — M4c will
  likely want to add a `signAndSubmit` helper to the adapter when it starts
  building real transactions.
- **Map data**: `lib/map/city.json` is a direct copy of
  `games/blackout/map/city.json` (100 nodes, 293 edges, three ticket types)
  used today only for the static `<CityMapPreview />` SVG teaser
  (`components/map/city-map-preview.tsx`). M4c's real interactive board will
  need pawn positions, click targets, and animation — treat this preview as
  a starting reference, not the board itself.
- **On-chain evidence**: `lib/chain.ts` holds the live testnet referee
  contract ID and its stellar.expert URL — reuse this constant rather than
  re-hardcoding the address elsewhere.

## Notable implementation choices

- **Tailwind v4**, not v3 — CSS-first `@theme` tokens in `app/globals.css`
  instead of `tailwind.config.js`. Network access was available during this
  build, so the latest stable toolchain was used rather than pinning an
  older config-file-based version.
- **Next 16 + React 19 + Turbopack** — also latest-stable at build time.
- **No shadcn CLI / Radix** — `components/ui/*` are hand-authored,
  dependency-light equivalents (native `<dialog>` for the Dialog primitive
  instead of Radix, `class-variance-authority` + `tailwind-merge` for variant
  styling like shadcn itself uses). This was a deliberate choice for a
  smaller dependency surface, not a network fallback — `pnpm dlx shadcn` was
  never attempted.
- **`@stellar/freighter-api` is a real dependency** (v6.0.1) — its published
  type declarations reference an internal, unpublished path alias
  (`@shared/api/types`) that doesn't resolve outside Freighter's own
  monorepo. `skipLibCheck: true` (inherited from the repo's
  `tsconfig.base.json`) avoids surfacing that as a typecheck failure; this
  was verified directly (see git history / build log) rather than assumed.
