#!/usr/bin/env node
// `pnpm --filter @zktable/liars-dice play` — plays one COMPLETE game of
// Liar's Dice on live Stellar testnet, with every player's roll a REAL
// `dice_valid` proof verified on-chain. Takes real proofs (~1s each) and
// real testnet txs (~5s each) — gated behind LIARS_TESTNET=1 so
// `vitest`/CI never accidentally spends testnet fees. Mirrors
// `games/blackout/src/play.ts`.
//
// Usage:
//   LIARS_TESTNET=1 pnpm --filter @zktable/liars-dice play
//
// Env overrides: LIARS_NETWORK, LIARS_SOURCE, LIARS_SEED, LIARS_MULTISIG
// (=1 signs each seat with its own funded identity — see identities.ts).

import { playLiarsDice } from './runner.js'

async function main(): Promise<void> {
  if (process.env.LIARS_TESTNET !== '1') {
    console.error(
      'Refusing to run: this plays a REAL game on Stellar testnet (real proofs, real fees, several minutes).\n' +
        'Set LIARS_TESTNET=1 to proceed, e.g.:\n' +
        '  LIARS_TESTNET=1 pnpm --filter @zktable/liars-dice play',
    )
    process.exit(1)
  }

  const transcript = await playLiarsDice({
    network: process.env.LIARS_NETWORK ?? 'testnet',
    source: process.env.LIARS_SOURCE ?? 'alice',
    seed: process.env.LIARS_SEED ?? `liars-dice-testnet-${Date.now()}`,
    multiSeat: process.env.LIARS_MULTISIG === '1',
    log: (line) => console.log(line),
  })

  console.log('\n=== TRANSCRIPT ===')
  console.log(JSON.stringify(transcript, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
