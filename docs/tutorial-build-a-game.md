# Build your own zkTable game in under 200 lines

This walks through `defineGame`, the one function you call to author a
zkTable game, using a small **real** example already in the repo:
`ticTacToe` (`packages/core/src/games/tic-tac-toe.ts`, 81 lines, fully
public — no hidden state, no ZK proofs). It plays to completion purely
through `@zktable/core`'s engine, with no chain and no circuit involved,
which makes it the clearest place to see the shape of `defineGame` before
adding any ZK primitive to the mix.

At the end, this doc shows exactly where a `zk.*` primitive would slot in
if this game had hidden state, and points you at the real games
(`games/blackout`, `games/liars-dice`, `games/coup-lite`) that actually use
one.

## The five pieces of a `defineGame` call

```ts
import { defineGame, zk } from '@zktable/core'

const game = defineGame({
  name: 'my-game',
  players: { min: 2, max: 2 },
  components: { /* zk-aware pieces: a board graph, a dice pool, a deck */ },
  state: { public: (ctx) => ({ /* ... */ }), secret: (ctx) => ({ /* ... */ }) },
  setup: (state, ctx) => state,               // optional, runs once
  turn: { order: 'clockwise', moves: { /* ... */ } },
  reveal: { when: (state) => boolean, what: ['path.to.secret'] },  // optional
  end: (state) => Outcome | null,
})
```

The ZK, on-chain, and AI layers are all *derived* from this one object — you
never write a circuit, a Soroban method, or a custom AI-safety check. Below,
each piece is filled in with tic-tac-toe's real code.

### 1. `players` — who's in the game

```ts
players: { min: 2, max: 2 }
```

Two seats, no roles. A game with asymmetric roles (like Blackout's Phantom
vs. Investigators) instead declares `roles: ['phantom', 'investigator']` and
uses `order: 'roles'` below — see "Adding hidden state" further down.

### 2. `state` — public and secret, split explicitly

```ts
state: {
  public: (ctx) => {
    const marks: Record<PlayerId, Mark> = {}
    const seatMarks: Mark[] = ['X', 'Y']
    ctx.players.forEach((p, i) => { marks[p.id] = seatMarks[i]! })
    return { board: Array<Cell>(9).fill(null), marks }
  },
  // no `secret` — tic-tac-toe has no hidden information
},
```

`state.public` builds the state every player (and, on-chain, the contract)
sees. An optional `state.secret(ctx)` builds *per-player* private state —
only that player's own `PlayerView.self.secret` ever contains it (see
"Adding hidden state" below for a game that uses this).

### 3. `turn` — order and moves

```ts
turn: {
  order: 'clockwise',
  moves: {
    place: {
      legal: (view: PlayerView): Move[] =>
        board(view).flatMap((cell, i) => (cell === null ? [{ type: 'place', cell: i }] : [])),
      apply: (state: MatchState, move: Move, ctx): MatchState => {
        const cell = move.cell as number
        const marks = state.public.marks as Record<PlayerId, Mark>
        const mark = marks[ctx.playerId]!
        const nextBoard = [...(state.public.board as Cell[])]
        nextBoard[cell] = mark
        return { ...state, public: { ...state.public, board: nextBoard } }
      },
    },
  },
},
```

Every move has two functions:

- **`legal(view)`** enumerates the moves currently available to *this*
  player, computed only from their `PlayerView` (public state + their own
  secret). The engine uses this for validity checking; AI agents use the
  exact same list to choose from — see "Why AI can't cheat" below.
- **`apply(state, move, ctx)`** is a **pure, deterministic reducer**. It has
  to give the same output for the same input everywhere it runs: in the
  browser for optimistic UI, inside an AI agent's lookahead, and — for a
  ZK-secured move — inside the on-chain Soroban referee after the proof
  verifies. Never reach outside `state`/`move`/`ctx` (no `Date.now()`, no
  randomness, no I/O).

A move can optionally carry a `zkp` binding (omitted here, since tic-tac-toe
has nothing to hide) — see "Adding hidden state."

### 4. `end` — win/lose/draw detection

```ts
end: (state: MatchState): Outcome | null => {
  const cells = state.public.board as Cell[]
  const marks = state.public.marks as Record<PlayerId, Mark>
  const win = winner(cells)
  if (win) {
    const winningPlayer = Object.entries(marks).find(([, m]) => m === win)?.[0]
    return winningPlayer ? { winner: winningPlayer } : null
  }
  if (cells.every((c) => c !== null)) return { winner: 'draw' }
  return null
},
```

Called after every move; return `null` while the game continues, or an
`Outcome` (`{ winner: playerId | playerId[] | 'draw' }`) once it's over.

### 5. `setup` and `reveal` (optional, not used by tic-tac-toe)

- **`setup(state, ctx)`** runs once after initial state is built — useful
  for anything that needs the full roster (e.g. Blackout deals starting
  positions and ticket counts here).
- **`reveal: { when, what }`** declares checkpoints where hidden state must
  be opened — Blackout's Phantom surfaces on rounds 3/8/13/18/24
  (`what: ['phantom.pos']`); Liar's Dice reveals both players' dice on a
  challenge.

## Running it

```ts
import { ticTacToe } from '@zktable/core'
import { Match } from '@zktable/core' // the engine

const match = new Match(ticTacToe, { players: [{ id: 'p1' }, { id: 'p2' }] })
match.submit('p1', { type: 'place', cell: 0 })
const view = match.view('p2')      // p2's PlayerView: public state + p2's own secret only
console.log(view.legalMoves)        // the moves the engine will accept from p2 right now
```

`packages/core/src/games/tic-tac-toe.test.ts` has the full playthrough
test. `pnpm --filter @zktable/core test` runs it (part of the 71 core
tests).

## Adding hidden state: where a ZK primitive plugs in

Say `my-game` needs a player to secretly hold one of a small set of cards
and later prove — without revealing which — that they hold a specific one.
That's exactly `deck`'s `card_membership` circuit, already shipped and used
by Coup-lite. Three things change from the tic-tac-toe shape above, and
*only* these three:

```ts
components: {
  court: zk.deck.of(['Duke', 'Assassin', 'Captain', 'Ambassador', 'Contessa']),
},

state: {
  public: (ctx) => ({ /* ... */ }),
  secret: (ctx) => ({ hand: dealTwoCardsFor(ctx.id) }),   // per-player, never leaks
},

turn: {
  moves: {
    claim: { legal: claimsFor, apply: applyClaim },        // plain public move, no zkp
    challenge: {
      zkp: zk.deck.proveHoldOrBluff(),                     // <-- the ZK binding
      legal: () => [{ type: 'challenge' }],
      apply: resolveChallenge,
    },
  },
},
```

That's it. You never write a circuit or a Soroban method:

- `zk.deck.of(...)` and `state.secret` describe the shape; the SDK's `deck`
  module (backed by the real `card_membership` Noir circuit, see
  `packages/circuits/card_membership/`) supplies the prover/verifier
  wiring.
- `zkp: zk.deck.proveHoldOrBluff()` on the `challenge` move tells the
  engine this move must carry a proof before the referee applies it.
  `apply` still runs as a pure reducer — the *legality* of a bluff-or-hold
  claim is enforced by the proof, not by `apply` itself.
- The on-chain `coup-referee` contract (`packages/contracts/contracts/coup-referee/`)
  reconstructs the proof's public inputs from its own stored commitments
  (see `docs/adr/004-proof-bound-to-authoritative-state.md`) and rejects
  any move whose proof doesn't verify — before `apply` ever runs.
- An AI agent choosing between `claim` and `challenge` sees exactly the
  same `PlayerView`/`legalMoves` a human client does — it cannot look at
  another player's `hand`. See `docs/adr/008-ai-moves-through-same-proof-path.md`.

## Fuller, real examples to read next

- **`games/liars-dice/src/liars-dice.ts`** (207 lines) — the smallest real
  ZK-secured game in the repo: a `dice` pool + a `sealed.commit`-style
  challenge/reveal (`zk.reveal.all('dice')`), two symmetric players, no
  roles. Good next read after this tutorial.
- **`games/coup-lite/src/coup-lite.ts`** — the `deck` module showcase
  sketched above, for real, with `zk.deck.proveHoldOrBluff()` wired to the
  live `card_membership` circuit and `coup-referee` contract.
- **`games/blackout/src/blackout.ts`** (192 lines) — the flagship: roles
  (`phantom`/`investigator`), a `board.graph` component, `zk.board.moveAlong`
  hidden movement, ticket resources, and reveal checkpoints. The most
  complete example of every `defineGame` field in one file.

Each of these plays a real game against a real on-chain referee via a
`play` script — see the top-level `README.md`'s Quick Start.
