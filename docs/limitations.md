# Limitations

zkTable is proven end-to-end on live Stellar testnet — three different
games, each ZK-verified on-chain, 234 TS tests + 84 Rust tests green. It is
a hackathon-scope SDK, not a production multiplayer platform. This document
is the itemized, honest account of where it falls short of that, with
pointers to the exact code and milestone reports so every claim here is
checkable.

## 1. `deck` v1.5: the deal is provably fair, but the dealer still sees the cards

**What's real (M8.3):** the deal is no longer trusted. The `valid_shuffle`
Noir circuit (`packages/circuits/valid_shuffle/src/main.nr`) proves the
entire 15-card committed deck (3 copies × 5 characters, real Coup) is the
canonical card set permuted by the UNIQUE order forced by an on-chain
commit-reveal seed; the `coup-referee` rebuilds the proof's public inputs
from its OWN stored seed and assigns hands by fixed deck position (player p
= leaves 2p, 2p+1). The dealer cannot choose who gets what — only learn it.
The `card_membership` "prove-hold" proof remains the load-bearing in-play
ZK, unchanged. Both are proven on testnet (`docs/milestones.md` M6.3, M8.3).

**What's still not real:** card **privacy from the dealer**. The
dealer/orchestrator generates the per-position salts and therefore sees
every card as it deals them out to players off-chain. Hiding the cards from
the dealer too is mental-poker/coSNARK territory (deck v2). See
`docs/adr/007-deck-v1-semi-honest-deal.md` for the original v1 rationale
this supersedes.

**Practical impact:** a colluding dealer can no longer stack the deck, but
can still *peek* at hands. Fine for AI opponents driven by a `PlayerView`
(they never see the dealer's data); not yet sufficient for adversarial
real-money play.

## 2. Per-seat `require_auth()` is live; lobby-phase setup is API-gated

**Fixed in M8.1:** every per-seat in-game entry point of all three referees
(`submit_hidden_move`/`submit_public_move`/`reveal`; `commit_nonce`/`bid`/
`challenge`/`reveal_dice`/…; `commit_seed_nonce`/`claim`/`prove_hold`/…)
now `require_auth()`s the seat's stored Stellar `Address`, fixed at
`join`/construction. Multi-wallet play is demonstrated on testnet
(`*_MULTISIG=1` runs — one funded identity per seat, wrong-signer attempts
rejected; see `docs/milestones.md` M8.1). The web app supports
Freighter-signed investigator moves via a prepare/sign/submit flow.

**Remaining caveat:** `join` and `start` (Blackout's lobby phase) are
deliberately permissionless — enrolling an address costs it nothing, and
requiring the joiner's signature would force wallet prompts inside
server-orchestrated match creation. Who may claim a seat in an open lobby
is an API-layer concern (the durable-store/matchmaking workstream), not a
contract one. Proof anti-replay (§7) is likewise unchanged.

## 3. Match state is durable-capable; scaling the orchestrator is not

**Improved in M8.4:** matches are persisted as serializable `MatchRecord`s
behind a `MatchStore` interface (`packages/web/lib/blackout/match-store.ts`).
With `REDIS_URL` set, records live in Redis (24 h TTL) and survive server
restarts; live runtimes are rehydrated by replaying the match's own event
log through a fresh engine mirror (`match-record.ts`). Matches are
resumable by URL (`/play/blackout?match=<id>`), human seats are bound to a
browser session cookie, and an open-match lobby
(`GET /api/blackout/matches`, `POST .../join`) exists.

**Remaining caveats:** without `REDIS_URL` the default store is still the
in-process map (demo mode); proving/AI still shell out to local binaries,
so one match must be driven by one process at a time (single-writer
assumed — no cross-instance move locking); and the session cookie is a
convenience binding, not authentication (the contract-level guarantee is
M8.1's `require_auth`).

## 4. Browser proving is live; the hidden-role UX is young

**Fixed in M8.5:** a human can now play the Phantom with the secret never
leaving their browser. `@zktable/prover-web` computes Poseidon2
commitments and the edge-tree witness client-side and generates the
UltraHonk proof with bb.js (keccak oracle) — CLI-parity is pinned by a
regression suite (a browser proof verifies with the native `bb` CLI
against the CLI-built VK, the same bytes the on-chain verifier holds; the
TS tree reproduces `zktable-graph`'s city root byte-for-byte). The web app
seats a human Phantom (`phantomSeat: 'human'`): the server holds no
phantom secret and no engine mirror for those matches (investigator
legality derives from the public graph), the browser posts only
`{commitment}`, `{c_new, ticket, proof}`, and reveal-round `(node, salt)`.

**Remaining caveats:** the AI Phantom still proves server-side with its
OWN secret (legitimate — ADR 008); the human-Phantom secret lives in
`localStorage` (clearing site data forfeits the match); ~1s/proof in Node
WASM, browser timing not yet benchmarked; and human-Phantom cannot yet be
combined with a Freighter-bound investigator seat in the same match.

## 5. N-player elimination is live locally; the Liar's Dice *contract* stays 2-player

**Fixed in M8.2:** `@zktable/core` now has a `turn.eliminated` hook — the
engine skips eliminated seats when advancing the turn. Coup-lite's
`defineGame` spans the referee's full 2–4 player range (a real 3-player
match with per-seat signing ran on testnet — `docs/milestones.md` M8.2),
and Liar's Dice supports 2–6 players locally with multi-round die-loss
elimination (a lost challenge costs one die; alive players re-roll; last
player with dice wins).

**Remaining caveat:** the `liars-dice-referee` *contract* still hard-locks
`n_players == 2` with single-round whole-seat loss (`UnsupportedConfig`
otherwise) — its per-round `dice_valid` re-roll protocol for survivors is a
separate contract workstream. The on-chain Liar's Dice demo therefore stays
2-player (the runner passes `lossMode: 'seat'` so the local mirror matches
the chain exactly).

## 6. Blackout's map is 100 nodes, not the classic 199-node topology

`games/blackout/map/city.json` is a deterministic, custom-generated 100-node
transit graph (taxi/bus/rail), chosen for build and on-chain proving
performance within this build's timeline. The classic 199-node London
topology was explicitly named a stretch goal in the PRD (§12.1, §19) and
was not attempted.

## 7. No anti-replay protection on proof verification

Noted specifically in the Coup-lite report (M6.3): `prove_hold`'s proof
verification is stateless — the same valid proof can be resubmitted for
another challenge round on the same underlying claim. The M6.3 on-chain
demo relies on this directly (the same real proof, generated once, is
submitted for two separate challenge rounds in that run, since the
underlying claim didn't change). This is inherited from the same stateless
`verify_proof` pattern every referee uses (see
`docs/adr/003-vendor-ultrahonk-verifier.md`). Fine for a demo/testnet
showcase; worth addressing (e.g. a per-move nonce bound into public inputs)
if this pattern is used somewhere replay genuinely matters.

## What this list deliberately does not include

Everything in `docs/milestones.md` is real, on-chain, and independently
checkable — every contract ID cited there resolves on
`stellar.expert/explorer/testnet`, every test count was re-verified while
writing these docs (234 TS tests across 7 packages via `pnpm -r test`; 84
Rust tests via `cargo +stable test --workspace` in `packages/contracts`).
The limitations above are genuine scope boundaries and known gaps, not
disclaimers about whether the ZK claims themselves are true.
