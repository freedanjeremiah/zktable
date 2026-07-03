# @zktable/agents

The zkTable AI-agent harness: a game-agnostic `Agent` interface, the
`HeuristicAgent` / `RandomAgent` baselines, and `ClaudeAgent`. Every agent sees
only a `PlayerView` (public state + its own secret) and moves through the exact
same ZK proof boundary as a human — so an AI opponent is mathematically
incapable of cheating.

Part of [zkTable](https://github.com/freedanjeremiah/zktable) — a TypeScript
SDK for building trustless, privacy-preserving board games on Stellar.

## Install

```bash
npm install @zktable/agents @zktable/core
```

## What's inside

- `Agent` — the interface every policy implements: given a `PlayerView`, return
  a legal move.
- `HeuristicAgent` / `RandomAgent` — deterministic baselines that need no API
  key; the default for local play and tests.
- `ClaudeAgent` — an LLM-backed policy. Set `ANTHROPIC_API_KEY` in the
  environment (server-side only — the key never reaches the browser).

Because agents only ever receive a `PlayerView`, they cannot see another
player's secret, and their moves are ZK-verified on-chain like any other.

## License

MIT — see [LICENSE](https://github.com/freedanjeremiah/zktable/blob/main/LICENSE).
