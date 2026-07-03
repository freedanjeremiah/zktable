# zkTable

> A TypeScript SDK for building trustless, privacy-preserving board games on
> Stellar. Declare a game; get zero-knowledge privacy, an on-chain referee,
> and cheat-proof AI opponents — without writing a circuit.

Every trustless board game needs the same plumbing: hide secret information,
prove moves are legal without revealing the secret, generate provably-fair
randomness, and keep authoritative state somewhere nobody can tamper with.
zkTable turns that plumbing into a library. You write an ordinary
declarative game definition; the SDK compiles it onto pre-built, audited
Noir circuits, a generic Soroban referee contract on Stellar testnet, and an
AI-agent harness whose opponents — because they move through the exact same
proof boundary as a human — are mathematically incapable of cheating. Three
very different games (a hidden-movement manhunt, a bluffing dice game, and a
hidden-hand social-deduction game) run on the same SDK, and every one of
their secret-dependent moves has been ZK-verified on live Stellar testnet.

Every secret-dependent move has on-chain evidence — the referee contract IDs
and live testnet explorer links are in the tables below.

## Compose, don't compile

The naive dream — "declare any game, auto-synthesize a custom circuit" — is
a research project. zkTable instead ships a small, fixed vocabulary of
**five ZK primitives**. Any turn-based hidden-information board game is
these five, composed:

| Primitive | Board-game use | What the ZK proves |
|---|---|---|
| `board` | hidden movement on a graph/grid | a move follows a legal edge from a hidden position to a new hidden position |
| `dice` | rolls, spinners, random draws | a roll is fair, unpredictable, and matches a commitment |
| `deck` | shuffle & deal cards | a claimed card really is in a player's committed hand (v1 — see Limitations) |
| `hidden` | secret hand / pieces / resources | a move is legal for a hidden value without revealing it |
| `sealed` | simultaneous moves, hidden bids | all players committed before anyone revealed |

You never write a circuit. You compose these primitives in a declarative
`defineGame` call; the SDK derives the ZK proof orchestration, the on-chain
referee calls, and the `PlayerView` an AI agent sees, all from that one
definition — a full game fits in under 200 lines.

The universal execution pattern, for every primitive:

```
   player / AI agent (off-chain)             Soroban contract (on-chain, the referee)
   ┌───────────────────────────┐             ┌─────────────────────────────────────┐
   │ holds secret state         │             │ stores public state + commitments   │
   │ chooses a move              │             │ turn order, ticket/resource counts  │
   │ builds a witness            │  submit tx  │ VERIFIES the ZK proof   ✅ / ❌       │
   │ generates a ZK proof  ──────┼────────────▶│ if valid → apply move, advance turn │
   └───────────────────────────┘             └─────────────────────────────────────┘
```

You cannot run a ZK *prover* on-chain — proving happens off-chain, verifying
happens on-chain, always. The referee contract never sees a secret, only a
proof that a secret-dependent move was legal.

## The three games

| Game | Primitive exercised | Players | On-chain evidence |
|---|---|---|---|
| **Blackout** — a noir hidden-pursuit manhunt (Scotland-Yard-style mechanics, original theme) | `board` (hidden movement) | 1 Phantom + N Investigators (flagship demo: 2) | referee [`CBYJDNG5OIBQDTLRX45ECUOT6JLB6NO2ALVY4F7DU6UGN4PVKJRVWPAG`](https://stellar.expert/explorer/testnet/contract/CBYJDNG5OIBQDTLRX45ECUOT6JLB6NO2ALVY4F7DU6UGN4PVKJRVWPAG) |
| **Liar's Dice** — hidden, provably-fair rolls + escalating bluff bids | `dice` + `sealed` | 2 | referee [`CDYGFZQDFYRW33NVUUU7REWW4LZNUXX4HP5MSMVWJ4AHZBYJZA23D5UU`](https://stellar.expert/explorer/testnet/contract/CDYGFZQDFYRW33NVUUU7REWW4LZNUXX4HP5MSMVWJ4AHZBYJZA23D5UU) |
| **Coup-lite** — hidden 2-card hands, public claims, prove-hold-or-bluff challenges | `deck` + `sealed` | 2 | referee [`CAYJ6HZPPQT7YFF2XTQGF2Q4HWMQZLIFIKT6ZJY6FHNBPXWL4ULQ5AGW`](https://stellar.expert/explorer/testnet/contract/CAYJ6HZPPQT7YFF2XTQGF2Q4HWMQZLIFIKT6ZJY6FHNBPXWL4ULQ5AGW) |

**Blackout** is the flagship: a hidden fugitive (the Phantom) moves secretly
across a 100-node city transit map (taxi/bus/rail); Investigators hunt them
down using only the Phantom's publicly-announced ticket type and periodic
reveals. Every Phantom move is a real `move_along` UltraHonk proof, verified
on-chain by the referee before the position commitment updates. It also has
a full interactive web UI — see below.

Every referee above is a genuinely separate contract deployment with its
own real UltraHonk verifier, proving the SDK's ZK path generalizes rather
than being hard-coded to one game. Each contract ID above links to its live
transaction history on the Stellar testnet explorer.

## Quick start

### Prerequisites

- Node ≥ 20, pnpm 10 (developed against pnpm 10.34.1)
- Rust stable + the `wasm32v1-none` target (pinned in `rust-toolchain.toml`)
- Noir `nargo` 1.0.0-beta.9 and Barretenberg `bb` v0.87.0, both on `PATH`
  (installed automatically by `packages/circuits/scripts/build_all.sh` into
  `~/.nargo/bin` / `~/.bb/bin` if missing)
- Stellar CLI 23+ with a funded testnet identity named `alice`:
  ```bash
  stellar keys generate alice --network testnet
  stellar keys fund alice --network testnet
  ```
  (only needed for the on-chain runners / web app deploys below — `pnpm test`
  needs none of this)

### Install and run the offline test suite

```bash
pnpm install
pnpm test         # all TS packages: 234 tests, no chain/toolchain needed
```

### Build the ZK circuits (needed for anything that proves)

```bash
packages/circuits/scripts/build_all.sh
# compiles every Noir circuit (move_along, dice_valid, card_membership, plus
# the M0 sanity circuits) to ACIR, generates a witness, and writes an
# UltraHonk proof/vk with `bb` — installs nargo/bb first if not on PATH
```

### Run the Rust contract tests

```bash
cd packages/contracts
cargo +stable test --workspace   # 84 tests: verifier + all 4 referee crates
```

### Play a game headlessly against the real testnet referee

Each game ships a `play` script gated behind an explicit env var so tests
never accidentally spend testnet fees:

```bash
BLACKOUT_TESTNET=1 pnpm --filter @zktable/blackout play
LIARS_TESTNET=1    pnpm --filter @zktable/liars-dice play
COUP_TESTNET=1     pnpm --filter @zktable/coup-lite play
```

Each deploys a fresh verifier + referee contract to testnet, plays a real
game (real proofs, real transactions), and prints a full move-by-move
transcript plus the final on-chain `game_state()`.

### Run the web arcade

```bash
pnpm --filter @zktable/web dev
# open http://localhost:3000 — landing page, arcade lobby, and a fully
# interactive Blackout board at /play/blackout (deploys a real match on
# testnet, plays vs. an AI Phantom/Investigators, shows the shrinking
# possible-locations "shadow" and a live "proving… → verified on-chain ✓"
# indicator)
```

By default AI seats use a deterministic heuristic policy. Set
`ANTHROPIC_API_KEY` in the environment to use `ClaudeAgent` instead (server-side
only — the key never reaches the browser).

## Monorepo package map

| Package | What it is |
|---|---|
| `packages/core` (`@zktable/core`) | The SDK: `defineGame`, the deterministic turn/state engine, `PlayerView` construction, the `zk.*` component/move markers |
| `packages/circuits` (`@zktable/circuits`) | Noir (UltraHonk) circuits (`move_along`) + the TS `board` module's prover/verifier wrapper; `dice_valid`/`card_membership` circuits live here too, with game-local provers in `games/*` |
| `packages/contracts` (`@zktable/contracts`) | The vendored pure-Rust UltraHonk verifier (BN254 host functions) + one generic Soroban referee crate per game (`referee` for Blackout, `liars-dice-referee`, `coup-referee`) |
| `packages/agents` (`@zktable/agents`) | The `Agent` interface, `HeuristicAgent`/`RandomAgent`, and `ClaudeAgent` — every agent sees only a `PlayerView` (public state + its own secret) |
| `packages/web` (`@zktable/web`) | The Next.js arcade: landing page, lobby, Freighter wallet connect, and the interactive Blackout board + match API |
| `games/blackout`, `games/liars-dice`, `games/coup-lite` | The three `defineGame` game definitions, AI strategies, and headless testnet runners |

## Published npm packages

All nine packages are published to npm under the
[`@zktable`](https://www.npmjs.com/org/zktable) scope at version `0.1.0`
(public access). Workspace links are resolved to real versions at publish
time, so each package installs standalone.

```bash
# the SDK core + the ZK primitive wrappers
npm install @zktable/core @zktable/circuits

# AI agents (HeuristicAgent / RandomAgent / ClaudeAgent)
npm install @zktable/agents

# browser proving helper (Noir + bb.js)
npm install @zktable/prover-web
```

| Package | npm | Install |
|---|---|---|
| `@zktable/core` | [npmjs.com](https://www.npmjs.com/package/@zktable/core) | `npm i @zktable/core` |
| `@zktable/circuits` | [npmjs.com](https://www.npmjs.com/package/@zktable/circuits) | `npm i @zktable/circuits` |
| `@zktable/contracts` | [npmjs.com](https://www.npmjs.com/package/@zktable/contracts) | `npm i @zktable/contracts` |
| `@zktable/agents` | [npmjs.com](https://www.npmjs.com/package/@zktable/agents) | `npm i @zktable/agents` |
| `@zktable/prover-web` | [npmjs.com](https://www.npmjs.com/package/@zktable/prover-web) | `npm i @zktable/prover-web` |
| `@zktable/blackout` | [npmjs.com](https://www.npmjs.com/package/@zktable/blackout) | `npm i @zktable/blackout` |
| `@zktable/liars-dice` | [npmjs.com](https://www.npmjs.com/package/@zktable/liars-dice) | `npm i @zktable/liars-dice` |
| `@zktable/coup-lite` | [npmjs.com](https://www.npmjs.com/package/@zktable/coup-lite) | `npm i @zktable/coup-lite` |
| `@zktable/web` | [npmjs.com](https://www.npmjs.com/package/@zktable/web) | `npm i @zktable/web` |

The TypeScript packages ship ESM + CJS builds with `.d.ts` types.
`@zktable/contracts` ships the Rust source (Soroban referee + vendored
UltraHonk verifier); `@zktable/web` ships the Next.js arcade source.

## Limitations — read this before you trust it with real stakes

zkTable is a hackathon-scope SDK proven end-to-end on live testnet, not a
production multiplayer platform. Specifically, and honestly:

- **The `deck` module is a semi-honest committed deal, not full
  mental-poker.** `card_membership` genuinely proves in zero knowledge that
  a claimed card is in a player's committed hand — that part is real. But
  nothing yet proves the *deal itself* came from a fair shuffle over a
  shared, non-repeating deck (that would need a `valid_shuffle` circuit
  proving the permutation is a bijection, per PRD §7.2). Coup-lite's dealer
  is trusted for shuffle honesty in v1.
- **Referee contracts have no `require_auth()` yet.** Every move on every
  referee (Blackout, Liar's Dice, Coup-lite) is called by player index, not
  bound to a Stellar `Address`. This is fine for the demo shape — a single
  wallet orchestrates every seat, and the ZK proofs plus the on-chain
  referee's state machine are the real trust anchor for move legality — but
  it means, as shipped, any signer could call a move on behalf of any
  player index. Per-caller authorization is the concrete hardening step
  before real multiplayer with independent wallets per seat.
- **Match state lives in an in-memory, single-process store** (the web
  app's `MatchRuntime` map). It doesn't survive a server restart and
  doesn't scale past one Node process. Fine for a demo; a real deployment
  needs a persistent, multi-instance-safe store.
- **The AI Phantom/agents prove server-side, using their own secret** —
  that's legitimate (an AI agent proving its own hidden move is no
  different from a human client doing so), but a *human* playing the hidden
  role (e.g. a human Phantom) needs client-side proving. The pieces for
  that exist (Noir + `bb.js` is browser-capable) but browser-side proving
  isn't wired into the web app yet; today the human seat is always a
  public-move role (e.g. Investigator).
- **Liar's Dice and Coup-lite's on-chain demos are 2-player.** Liar's Dice's
  referee is intentionally hard-locked to exactly 2 players (single-round
  elimination is only sound starting from 2). Coup-lite's referee contract
  natively supports 2–4 players and is proven for 3 players in native
  tests, but the shipped `defineGame`/on-chain demo runs 2-player, because
  the generic turn engine doesn't yet skip eliminated players' turns.
- **Blackout's map is 100 nodes**, not the classic 199-node London
  topology — a deliberate v1 scope choice for build/perf time, not a
  full-scale re-implementation.

## License

MIT — see [`LICENSE`](./LICENSE).
