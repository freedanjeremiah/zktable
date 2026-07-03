# @zktable/prover-web

Browser-side UltraHonk prover helpers for zkTable `board` moves. Wraps Noir
(`@noir-lang/noir_js`) and Barretenberg (`@aztec/bb.js`) so a human playing a
hidden role can generate a real proof client-side — the secret never leaves the
browser.

Part of [zkTable](https://github.com/freedanjeremiah/zktable) — a TypeScript
SDK for building trustless, privacy-preserving board games on Stellar.

## Install

```bash
npm install @zktable/prover-web
```

## What's inside

- Helpers to compile/execute the `move_along` circuit witness and produce an
  UltraHonk proof + public inputs in the browser.
- The proving half of the pipeline; verification always happens on-chain in the
  Soroban referee.

> Proving happens off-chain (here, in the browser); verifying happens on-chain,
> always. The referee never sees a secret — only a proof that a
> secret-dependent move was legal.

## License

MIT — see [LICENSE](https://github.com/freedanjeremiah/zktable/blob/main/LICENSE).
