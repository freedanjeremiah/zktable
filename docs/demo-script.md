# zkTable demo script (2–3 minutes)

A spoken walkthrough for a live or recorded demo. **[Bracketed cues]** are
on-screen actions; plain text is narration. Assumes `pnpm --filter
@zktable/web dev` is running against a funded testnet identity, with
`ANTHROPIC_API_KEY` unset (so AI seats use the deterministic heuristic
policy — no external API latency during the demo) unless you specifically
want to show `ClaudeAgent`.

---

## 0:00–0:20 — The hook (landing page)

**[Open `http://localhost:3000/`. Let the hero load.]**

"This is zkTable — a Stellar SDK for trustless board games. The pitch is one
sentence: **the AI can't cheat.**

Every hidden-information game needs the same plumbing — hide a secret, prove
a move is legal without revealing it, keep a tamper-proof referee. Normally
every team rebuilds that from scratch. zkTable turns it into a library call:
you declare a game, and you get zero-knowledge privacy, an on-chain referee,
and AI opponents for free — without writing a single circuit."

**[Scroll past the five-primitive list — board, dice, deck, hidden, sealed —
just enough to show it exists, don't linger.]**

"Five primitives. Every game on this SDK is these five, composed."

## 0:20–0:35 — Into the arcade

**[Click through to `/arcade`.]**

"Three real games ship on top of it: Blackout, our flagship hidden-pursuit
manhunt; Liar's Dice; and Coup-lite. All three have been fully verified on
live Stellar testnet — not a demo mode, a real chain. Let's play Blackout."

## 0:35–1:00 — Starting the match

**[Click into Blackout, pick investigator count (2 is fine for demo speed),
click "Deploy a real match."]**

"This isn't mocked — it's deploying a fresh verifier contract and a fresh
referee contract to testnet right now, live." **[Point at the elapsed-time
counter while it deploys, ~15–120 seconds depending on testnet latency —
this is real, said plainly on screen, not a fake progress bar.]**

"One hidden Phantom against a team of Investigators. The Phantom moves in
secret across this transit map — taxi, bus, rail — and only announces which
*type* of ticket it used. Investigators have to deduce where it went."

## 1:00–1:40 — The Phantom moves; the ZK is felt

**[The Phantom's opening move resolves — an AI Phantom, heuristic-driven.
Point at the proof-status card.]**

"Watch this indicator: **'Phantom is moving in the dark…'** — that's a real
UltraHonk proof being generated right now, off-chain, over the Phantom's
actual hidden position. And there — **verified on-chain ✓.** That's not a
UI animation; that's a live Soroban contract call that just checked a
zero-knowledge proof and only then updated the Phantom's position
commitment."

**[Click the stellar.expert link in the proof-status card.]**

"Here's the real referee contract on Stellar's testnet explorer. Anyone can
audit every move this game has made."

**[Point at the "shadow" — the translucent haze of candidate nodes on the
map.]**

"This fog is the Investigators' actual knowledge: every node the Phantom
*could* be on, computed client-side from nothing but the public map and the
announced ticket types. As the Phantom moves, it shrinks. As Investigators
close in, it collapses."

## 1:40–2:10 — Play a move, hit a reveal

**[Click a legal move as the human Investigator seat.]**

"I'll move as an Investigator." **[The move submits; AI investigators and
the Phantom's next move play out automatically.]** "Every one of those is
a real transaction — the human move, the AI teammates, and another Phantom
proof, all in one turn."

**[If a reveal round lands during the demo, narrate it; otherwise skip to
the next beat.]**

"On rounds 3, 8, 13, 18 and 24, the Phantom has to surface — a real
commitment-opening check on-chain, not a trust-me. **[Point at the reveal
spotlight and the collapsed shadow.]** There it is — the fog collapses to
exactly one node, because the chain just confirmed it."

## 2:10–2:30 — Generality: the other two games

**[Cut back to `/arcade` or just narrate over a screenshot/tab.]**

"Blackout proves the `board` primitive — hidden movement on a graph. The
same SDK also ships Liar's Dice, which proves the `dice` primitive:
provably-fair, unforgeable hidden rolls, with a real UltraHonk proof
generated and verified on-chain for every roll. And Coup-lite, which proves
the `deck` primitive: a player proving in zero knowledge that they actually
hold a card they're claiming, without a challenger ever seeing their hand.
Three visibly different games, one SDK, zero hand-written circuits at the
game layer."

## 2:30–2:45 — Close

"Every claim here is checkable: real contract IDs, real transaction
hashes, real on-chain outcomes — they're all in the repo's milestone log,
not just in this recording. That's zkTable: declare a game, get trustless
privacy and cheat-proof AI, for free."

**[End on the landing page or the stellar.expert contract view.]**

---

## Notes for whoever records this

- A full 24-round Blackout game is slow by construction (each round is a
  real proof + testnet transaction, observed 10–45+ seconds/round in prior
  runs) — this script deliberately stops after 1–2 rounds plus, ideally, one
  reveal. Don't try to play to a win on camera.
- If testnet is slow that day, the deploy step (~15–120s observed across
  milestone reports) is the most likely place to stall; consider recording
  the deploy once, then cutting to a second take for the live moves, and
  saying so on screen rather than pretending it was instant.
- The exact `stellar.expert` contract link shown will be whichever referee
  this specific demo run deployed (a fresh one per match — see
  `docs/adr/006-per-match-referee-in-memory-store.md`) — it will not match
  the contract IDs cited in `docs/milestones.md`, which are prior runs'
  contracts. That's expected, not a bug: point it out if asked.
