# zkTable — Milestone Log

Running record of completed build milestones (PRD §18) with on-chain evidence.

## M0 — Scaffold & prove the pipeline works ✅

**Done:** 2026-07-03. The full Noir → UltraHonk → Soroban pipeline verifies a real
proof inside a live testnet contract, and rejects a tampered one.

- Monorepo scaffolded: pnpm workspaces + Turborepo, `rust-toolchain.toml` pinned
  to stable / `wasm32v1-none`, base tsconfig.
- Vendored the pure-Rust UltraHonk verifier (BN254 host functions) into
  `@zktable/contracts` as `crates/ultrahonk-verifier` + the `zktable-verifier`
  wrapper contract. 9/9 native + Soroban-host tests pass.
- `@zktable/circuits` holds Noir circuits + build scripts; `simple_circuit` and
  `fib_chain` build to real `proof`/`vk`/`public_inputs`.

**On-chain evidence (Stellar testnet, Protocol 27):**

| What | Value |
|---|---|
| Verifier contract | `CDLQFMXZCDKDIBAAX742TNNFGY2SYOVHT6A3URKJHZTS7FSBEXM5YKEZ` |
| Valid-proof verify tx | `0f3ea548a9953442ae2ff11d62cf27e49035b2be051a12a0f9cb69a11d8db32f` |
| Deploy tx | `67e0d4ae6ccb68e7e9f43a7b1f8f8e4a5fc7b955a09acf2e6365dcb9dca3c1e2` |
| Tampered proof | rejected — `Error(Contract, #4)` (`VerificationFailed`) |

Reproduce: `packages/contracts/scripts/deploy_verifier.sh simple_circuit alice testnet`

## M1 — `@zktable/core` engine skeleton ✅

**Done:** 2026-07-03 (commit `26eab2c`). Declarative `defineGame`, deterministic
turn/state engine, legal-move enumeration, per-player `PlayerView` (own secret
only), reveal-checkpoint + win-detection seams, and a `zk.*` marker namespace.
Fully-public tic-tac-toe plays to completion. 66 Vitest tests pass; `tsc` + `tsup`
clean. No ZK yet — clean seams left for M2 (`submit` proof binding, `commitments`
map, reveal flow).

## M2 (in progress) — `board` module + `move_along` circuit

**ZK core done + on testnet:** the `move_along` Noir circuit (hidden position →
hidden position along a legal graph edge) proves and verifies on live testnet.
The off-chain edge-tree/witness builder (`zktable-graph`, using soroban-poseidon)
produces Poseidon hashes **byte-identical** to the circuit — verified by matching
bb's `public_inputs` to the tool's output exactly.

| What | Value |
|---|---|
| `move_along` verifier contract | `CCTNXQP6TAYPRYIJKP6MPJZUUPNVMV6BQID4NHLSCYKWK3JZEBAGFWEO` |
| Legal hidden move | proof verified on-chain (`null`/Ok) |
| Illegal edge | rejected off-chain (no valid witness) |
| Public-input layout | `[c_old, c_new, ticket, root]` (128 B) — matches bb |

## M2 — `board` module + `move_along` circuit + generic referee ✅

**Done:** 2026-07-03. The full hidden-movement stack works on live testnet.

- **`move_along` circuit** (commit `d69956d`): hidden→hidden move along a legal
  graph edge; Poseidon2 commitments + depth-10 edge-Merkle membership.
- **`zktable-graph` tool** (commit `d69956d`): off-chain edge-tree/witness/commitment
  builder; Poseidon byte-identical to circuit (bb `public_inputs` match exactly).
- **TS `board` module** `@zktable/circuits` (commit `396b1b1`): `BoardGraph` +
  `BoardProver` generate & verify real UltraHonk proofs; 9 tests.
- **`zktable-referee` contract** (commit `773226a`): binds each proof to its OWN
  stored `c_old` + graph root before cross-contract-verifying; enforces turn
  order, roles, tickets, reveal/capture. 11 native tests incl. a real
  cross-contract proof verification + binding-rejection (wrong c_old / wrong root).

**On-chain evidence (testnet) — a ZK-verified hidden move through the referee:**

| What | Value |
|---|---|
| Referee contract | `CDZFHUWWIXKCIKZIWNV3AEC4MHBED3FQL3VS2JIUXC6OPFI57CJ7JOPL` |
| move_along verifier | `CCFSPUAXSXAA5Y7YOGVNCZFJFF67J2AYRT25YHM2O6CNQFRFCHGZYDK4` |
| `submit_hidden_move` tx | `a0a2e1193508beab25f5962ffab1011edccc31c13509bbc6332164f78e376af1` (Ok) |
| State after | phantom commitment → `c_new`, taxi 10→9, `ticket_feed=[0]`, turn→investigator |

Known gap: referee has no `require_auth()` yet (fine for headless single-wallet;
harden before multiplayer — tracked).

## M3 — Flagship "Blackout" playable (headless) ✅

**Done:** 2026-07-03 (commit `1a28a60`). Blackout — the Scotland-Yard-style
hidden-pursuit flagship — plays a full seeded game locally to a definite
outcome, and ran a complete game on live Stellar testnet with every Phantom
move ZK-verified by the on-chain referee and an on-chain reveal.

- `@zktable/blackout`: the `defineGame` definition (192 lines incl.
  comments), a 100-node deterministic city transit map (`taxi`/`bus`/`rail`),
  seeded deterministic strategies, a typed `CliRefereeClient` wrapper over the
  proven `stellar` CLI sequence, and an on-chain orchestrator
  (`playBlackout`).
- Core addition: `Match.setSecret(playerId, secret)` in `@zktable/core`
  (keeps the local `Match.view` in sync with the Phantom's committed
  position after a hidden move — the seam M4/M5 prediction and agents need).
- 45 blackout tests + 69 core tests green; `tsc --noEmit` clean on both.

**On-chain evidence (Stellar testnet) — a full 3-round game to a real
`Finished` outcome:**

| What | Value |
|---|---|
| move_along verifier | `CC37ZPYG534WVKFYEWDRIKCZX4UMJECOHL6BNRHL3ZCBIN4RKTTWEGIE` |
| Referee (this run) | `CBYJDNG5OIBQDTLRX45ECUOT6JLB6NO2ALVY4F7DU6UGN4PVKJRVWPAG` |
| Graph root | `269be05bcbc68ecee8560f389c450f6a8f99a3b34343862b9762e55801092c5d` |
| n_rounds / reveal_rounds | 24 / [3, 8, 13, 18, 24] |
| Phantom moves | 3× `submit_hidden_move`, each a fresh 14592-byte UltraHonk proof, all **Ok** |
| Reveal | round 3, node 14 → capture → `outcome: "investigator"`, `reveal_log=[[3,14]]` |

Reproduce: `BLACKOUT_TESTNET=1 BLACKOUT_SCRIPTED_CAPTURE_ROUND=3 pnpm --filter @zktable/blackout play`
(omit the scripted-capture round to play out naturally to round 24). The
scripted capture is a labeled, opt-in test aid (not a contract-enforced
mechanic — `submit_public_move` doesn't check adjacency on-chain, a
documented v1 simplification) that bounds a demo run to minutes instead of a
full 24-round game.

## M4 — Web app + Blackout board UX ✅

Three sub-milestones, done 2026-07-03, commits `1f99458` (M4a shell),
`93423e2` (M4b backend + M5b, see below), `6770ba2` (M4c interactive board).

**M4a — `@zktable/web` shell** (`1f99458`): Next.js arcade shell — landing
page ("The AI can't cheat."), `/arcade` lobby, a placeholder `/play/blackout`
route, Freighter wallet connect (`@stellar/freighter-api`, with a hand-traced
fix for Freighter's `requestAccess()` hanging forever with no extension
installed). `next build`/`lint`/`typecheck` all clean.

**M4b — Blackout web backend** (`93423e2`): the match orchestration API
(`POST /api/blackout/matches`, `GET .../[id]`, `POST .../moves`,
`POST .../ai-turn`) — deploys a fresh verifier + referee per match, drives
human moves + AI turns (heuristic by default, `ClaudeAgent` if
`ANTHROPIC_API_KEY` is set), all server-side. Real testnet acceptance run:
3 rounds, 3 real ZK proofs verified on-chain via `submit_hidden_move`, 1
successful `reveal`, independently cross-checked with `stellar contract
invoke` (not just the API's own word).

| What | Value |
|---|---|
| Referee (this run) | `CCPD5W5XV5NSCRXQER6UWB3AUIRCLWE2R57ZTOYBUIRONBDKBN5QUR2W` |
| Verifier | `CBWCVTY34ZT7END5BOK2FVCGBROBJSRFJ7IEH3TP2B35XUXSL7UVCVCV` |
| Result | round 3, `revealLog=[[3,19]]`, chain state matches the API's DTO byte-for-byte |

**M4c — interactive Blackout board** (`6770ba2`): the real board UI at
`/play/blackout` — SVG transit map, a client-computed "possible-locations
shadow" (`lib/board/shadow.ts`, TDD, 9 tests) that shrinks with each
Phantom ticket announcement and collapses on reveal, a live proof-status
card ("proving… → verified on-chain ✓" with a stellar.expert link), ticket
feed, event log. Verified live in-browser (not simulated) against the real
M4b API: 3 real AI-Phantom proofs generated and accepted on-chain during one
recorded session, including a reveal.

| What | Value |
|---|---|
| Referee (this run) | `CB54XXISO2G66KPGVVHFHEID27WF424NK53365CED67RBDNX6DOTDVPQ` |
| Verifier | `CBTXZBB4CZT4RR7P4MVQVDWFEB6HL4MQO7IKHIMYNUQ7E7CR7JOAFQTM` |

`pnpm --filter @zktable/web build`/`lint`/`typecheck`/`test` all clean;
22 web-package vitest tests pass.

## M5 — AI agents ✅

Done 2026-07-03. Two parts:

**M5a — `@zktable/agents` harness** (commit `ae0fe6b`): the game-agnostic
`Agent` interface (`act(view, legalMoves)`), `HeuristicAgent`/`RandomAgent`
baselines, and `ClaudeAgent` (Anthropic SDK, default model
`claude-haiku-4-5`, forced tool-use `choose_move`, falls back to
`legalMoves[0]` on any API/parsing failure — never throws into the game
loop, never returns an illegal move). 20 tests, including an explicit
anti-cheat test asserting a `PlayerView`'s shape (`Object.keys`) structurally
cannot carry another player's secret.

**M5b — Blackout AI policies** (folded into commit `93423e2`, alongside
M4b): `blackoutPhantomPolicy`/`blackoutInvestigatorPolicy` adapt the seeded
heuristics from M3's `strategy.ts` to the `Agent`/`Policy` shape; tested by
driving a full local match purely through `HeuristicAgent.act(view,
legalMoves)` to a definite outcome — the concrete proof that the AI Phantom
only ever sees its own `PlayerView`.

**The "AI can't cheat" property, demonstrated on-chain:** in the M4b/M4c
testnet runs above, the AI Phantom's moves are proven with the exact same
`BoardProver`/`submit_hidden_move` path a human client would use — there is
no privileged server-side shortcut that lets the AI skip the ZK proof.

## M6 — Arcade breadth: `dice` + Liar's Dice, then `deck` + Coup-lite ✅

Three sub-milestones, done 2026-07-03.

**M6.1 — `dice_valid` circuit** (commit `27ea3eb`): a Noir circuit proving
each of a player's 5 hidden dice is (a) committed (`Poseidon2(die, salt)`),
(b) a valid face in `{1..6}`, and (c) the canonical, **in-circuit-bound**
reduction of a per-die hash derived from a public shared seed and player id
— so the roll is unforgeable before it's even revealed, not just checked
against a commitment at reveal time. Verified with a real UltraHonk
proof/verify round-trip (14592-byte proof) and three negative tests: a
tampered proof, tampered public inputs, and a seed-inconsistent forged die
all correctly rejected (the last one by the circuit's own constraint, via
`nargo execute`, not just an off-chain check).

**M6.2 — Liar's Dice** (commit `02124b6`): the `zktable-liars-dice-referee`
Soroban contract (commit-nonce → reveal-nonce → roll → bid → challenge →
reveal → resolve) plus `@zktable/liars-dice`'s `defineGame`. v1 is hard-locked
to exactly 2 players (a single elimination round is only sound starting from
2). 9/9 native contract tests (incl. two proof-binding rejection tests: wrong
seed, wrong player index) + 28/28 local TS tests. A complete real game ran on
testnet: 2 real `dice_valid` UltraHonk proofs verified cross-contract, a real
sealed nonce commit-reveal, a real bid/challenge/reveal, resolving to a
hand-verifiable winner.

| What | Value |
|---|---|
| Referee | `CDYGFZQDFYRW33NVUUU7REWW4LZNUXX4HP5MSMVWJ4AHZBYJZA23D5UU` |
| Verifier | `CDBJEN5EGYTPT7J5QMDBKCR3DDBSN6JRKYH3EKA6AD7E2LRH2WWNNTBH` |
| Result | player1 bid "4× face 5"; player2 challenged; true count was 4 → challenger loses → `outcome: "player1"` (hand-verified against the real dice `[1,5,4,5,5]`/`[5,6,1,2,3]`) |

**M6.3 — Coup-lite** (commit `93cf490`): the `card_membership` Noir circuit
(proves a claimed character is in a player's committed 2-card hand, without
revealing the other card or the slot), the `zktable-coup-referee` contract
(deal → claim → challenge → prove-hold-or-reveal, 2–4 players supported
natively), and `@zktable/coup-lite`'s `defineGame` (2-player showcase). This
is the module with an explicit, documented honest simplification: the deal
itself is **semi-honest** (a trusted dealer supplies commitments; no
`valid_shuffle` circuit proves the deal came from a fair permutation — see
PRD §7.2 and [Limitations](../README.md#limitations--read-this-before-you-trust-it-with-real-stakes)).
10/10 native contract tests + 33/33 local TS tests. A real on-chain game
found and fixed a genuine turn-advance bug (`reveal_card` wasn't advancing
`turn`, diverging the contract from the local engine's mirror) before
completing successfully.

| What | Value |
|---|---|
| Referee | `CAYJ6HZPPQT7YFF2XTQGF2Q4HWMQZLIFIKT6ZJY6FHNBPXWL4ULQ5AGW` |
| Verifier | `CBEITCP4VR7KZXNGVAU72OXZ3BMCKZJ675IO45WCFIXNEVARHHQQ3TZZ` |
| Result | player1's real hand held Captain; 2 real `card_membership` "prove-hold" proofs verified on-chain across 2 challenge rounds; player2 lost both influence → `outcome: "player1"` |

By the end of M6, all three arcade games are playable end-to-end against a
real on-chain referee, each exercising a different ZK module
(`board`/`dice`/`deck`), each independently proven on live testnet. Total
test suite at this point: 234 TS tests (Vitest, across 7 packages) + 84 Rust
tests (`cargo test --workspace`, across the verifier and all 3 referee
crates), all green.

## M7 — Polish, docs, demo ✅

**Done:** 2026-07-03. The final documentation pass: this file (extended
M0–M7), the top-level `README.md` rewrite, `docs/adr/` (7 short ADRs
covering the load-bearing design decisions), `docs/tutorial-build-a-game.md`
("build your own zkTable game in under 200 lines," walking through
`ticTacToe`), `docs/demo-script.md` (a 2–3 minute spoken walkthrough), and
`docs/limitations.md` (the itemized honest-limitations list). No package or
contract code changed in this milestone — all 234 TS + 84 Rust tests remain
green, confirmed by re-running the full suite before writing this entry.
