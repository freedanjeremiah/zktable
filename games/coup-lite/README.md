# @zktable/coup-lite

**Coup-lite** — hidden 2-card hands, public claims, and prove-hold-or-bluff
challenges. The zkTable `deck` module showcase: `card_membership` proves in zero
knowledge that a claimed card really is in a player's committed hand, without
revealing the hand.

Part of [zkTable](https://github.com/freedanjeremiah/zktable) — a TypeScript
SDK for building trustless, privacy-preserving board games on Stellar.

## Install

```bash
npm install @zktable/coup-lite @zktable/core
```

## What's inside

- The `defineGame` definition for Coup-lite (the `deck` + `sealed` primitives),
  its AI strategies, and a headless testnet runner.
- The referee contract natively supports 2–4 players; the shipped on-chain demo
  runs 2-player.

> v1 note: the deal is a semi-honest committed deal, not full mental-poker.
> `card_membership` is real ZK; the shuffle itself is trusted in v1. See the
> repo's limitations section.

## Play it on live testnet

```bash
COUP_TESTNET=1 pnpm --filter @zktable/coup-lite play
```

Deploys a fresh verifier + referee to Stellar testnet, plays a real game (real
proofs, real transactions), and prints a full move-by-move transcript.

## License

MIT — see [LICENSE](https://github.com/freedanjeremiah/zktable/blob/main/LICENSE).
