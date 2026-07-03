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

## 3. Match state is in-memory and single-process

The web app's match store (`packages/web/lib/blackout/match-store.ts`) is a
`Map` attached to `globalThis`, scoped to one Node process. It survives
Next.js dev-server Fast Refresh reloads but not a server restart, and
doesn't work across multiple server instances. See
`docs/adr/006-per-match-referee-in-memory-store.md`. A production
deployment needs a persistent store (e.g. a database keyed by match ID,
storing the referee contract ID and roster) — this doesn't require changing
any referee's on-chain logic, only how matches are created and looked up.

## 4. The AI Phantom proves server-side, using its own secret — legitimate, but browser proving for a human in the hidden role isn't wired up

When an AI agent (heuristic or `ClaudeAgent`) plays a hidden role like
Blackout's Phantom, it proves its own moves server-side, through the exact
same `BoardProver`/`submit_hidden_move` path a human client would use (see
`docs/adr/008-ai-moves-through-same-proof-path.md`) — this is legitimate:
an agent proving knowledge of its *own* secret is no different in kind from
a human doing so.

What's genuinely missing: a **human** playing a hidden role (e.g. a human
Phantom, rather than an AI one) needs the proof generated client-side, in
the browser, so their secret never leaves their machine even to a trusted
server. Noir + `bb.js` is browser-capable (PRD §14) and the SDK's proof
orchestration is designed to support it, but the web app's proving pipeline
today runs server-side only — a human playing Blackout is always seated as
an Investigator (a public-move role), never as the Phantom.

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
