# @zktable/core

The zkTable SDK core: a declarative game model (`defineGame`), a deterministic
turn/state engine, `PlayerView` construction, and the `zk.*` component/move
markers that wire a game onto zkTable's five ZK primitives.

Part of [zkTable](https://github.com/freedanjeremiah/zktable) — a TypeScript
SDK for building trustless, privacy-preserving board games on Stellar.

## Install

```bash
npm install @zktable/core
```

## What's inside

- `defineGame(...)` — declare a turn-based hidden-information game as data:
  its components (`board`, `dice`, `deck`, `hidden`, `sealed`), moves, turn
  order, and win conditions.
- The deterministic engine — applies moves, advances turns, and derives the
  authoritative public state that the on-chain referee mirrors.
- `PlayerView` — the exact slice of state a player (or AI agent) is allowed to
  see: public state plus its own secret, nothing else.

You never write a circuit. You compose the primitive markers; the SDK derives
the proof orchestration, referee calls, and the `PlayerView` from that one
definition.

## License

MIT — see [LICENSE](https://github.com/freedanjeremiah/zktable/blob/main/LICENSE).
