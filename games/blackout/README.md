# @zktable/blackout

**Blackout** — a noir hidden-pursuit manhunt (Scotland-Yard-style mechanics,
original theme) and the zkTable flagship game. A hidden fugitive (the Phantom)
moves secretly across a 100-node city transit map (taxi/bus/rail);
Investigators hunt them down using only the Phantom's publicly-announced ticket
type and periodic reveals. Every Phantom move is a real `move_along` UltraHonk
proof, verified on-chain by the referee before the position commitment updates.

Part of [zkTable](https://github.com/freedanjeremiah/zktable) — a TypeScript
SDK for building trustless, privacy-preserving board games on Stellar.

## Install

```bash
npm install @zktable/blackout @zktable/core
```

## What's inside

- The `defineGame` definition for Blackout (the `board` hidden-movement
  primitive), its AI strategies, and a headless testnet runner.
- `exercises the board primitive` — 1 Phantom + N Investigators (flagship
  demo: 2).

## Play it on live testnet

```bash
BLACKOUT_TESTNET=1 pnpm --filter @zktable/blackout play
```

Deploys a fresh verifier + referee to Stellar testnet, plays a real game (real
proofs, real transactions), and prints a full move-by-move transcript.

## License

MIT — see [LICENSE](https://github.com/freedanjeremiah/zktable/blob/main/LICENSE).
