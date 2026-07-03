#!/usr/bin/env node
// `pnpm --filter @zktable/coup-lite play` - plays one COMPLETE game of
// Coup-lite on live Stellar testnet, with every "prove-hold" challenge
// response a REAL `card_membership` proof verified on-chain. Takes real
// proofs (~1s each) and real testnet txs (~5s each) - gated behind
// COUP_TESTNET=1 so `vitest`/CI never accidentally spends testnet fees.
// Mirrors `games/liars-dice/src/play.ts`.
//
// Usage:
//   COUP_TESTNET=1 pnpm --filter @zktable/coup-lite play
//
// Env overrides: COUP_NETWORK, COUP_SOURCE, COUP_SEED, COUP_MULTISIG
// (=1 signs each seat with its own funded identity — see identities.ts).

import { playCoupLite } from './runner.js'

async function main(): Promise<void> {
  if (process.env.COUP_TESTNET !== '1') {
    console.error(
      'Refusing to run: this plays a REAL game on Stellar testnet (real proofs, real fees, several minutes).\n' +
        'Set COUP_TESTNET=1 to proceed, e.g.:\n' +
        '  COUP_TESTNET=1 pnpm --filter @zktable/coup-lite play',
    )
    process.exit(1)
  }

  const transcript = await playCoupLite({
    network: process.env.COUP_NETWORK ?? 'testnet',
    source: process.env.COUP_SOURCE ?? 'alice',
    seed: process.env.COUP_SEED ?? `coup-lite-testnet-${Date.now()}`,
    multiSeat: process.env.COUP_MULTISIG === '1',
    log: (line) => console.log(line),
  })

  console.log('\n=== TRANSCRIPT ===')
  console.log(JSON.stringify(transcript, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
