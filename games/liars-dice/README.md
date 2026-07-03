# @zktable/liars-dice

**Liar's Dice** — hidden, provably-fair rolls plus escalating bluff bids. The
zkTable `dice` + `sealed` showcase: each roll is ZK-proven fair, unpredictable,
and bound to a commitment before any bidding starts.

Part of [zkTable](https://github.com/freedanjeremiah/zktable) — a TypeScript
SDK for building trustless, privacy-preserving board games on Stellar.

## Install

```bash
npm install @zktable/liars-dice @zktable/core
```

## What's inside

- The `defineGame` definition for Liar's Dice (the `dice` + `sealed`
  primitives), its AI strategies, and a headless testnet runner.
- 2-player, single-round elimination — the referee is intentionally locked to
  exactly 2 players.

## Play it on live testnet

```bash
LIARS_TESTNET=1 pnpm --filter @zktable/liars-dice play
```

Deploys a fresh verifier + referee to Stellar testnet, plays a real game (real
proofs, real transactions), and prints a full move-by-move transcript.

## License

MIT — see [LICENSE](https://github.com/freedanjeremiah/zktable/blob/main/LICENSE).
