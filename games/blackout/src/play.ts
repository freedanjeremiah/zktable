#!/usr/bin/env node
// `pnpm --filter @zktable/blackout play` — plays one COMPLETE game of
// Blackout on live Stellar testnet, with every Phantom move ZK-verified by
// the on-chain referee. Takes real proofs (~1s each) and real testnet txs
// (~5s each), so a full run is minutes — gated behind BLACKOUT_TESTNET=1 so
// `vitest`/CI never accidentally spends testnet fees.
//
// Usage:
//   BLACKOUT_TESTNET=1 pnpm --filter @zktable/blackout play
//
// Env overrides: BLACKOUT_NETWORK, BLACKOUT_SOURCE, BLACKOUT_INVESTIGATORS,
// BLACKOUT_SEED, BLACKOUT_SCRIPTED_CAPTURE_ROUND (set to e.g. "3" to arrange
// an early scripted capture at that reveal round; unset plays out naturally
// up to n_rounds).

import { playBlackout } from './runner.js'

async function main(): Promise<void> {
  if (process.env.BLACKOUT_TESTNET !== '1') {
    console.error(
      'Refusing to run: this plays a REAL game on Stellar testnet (real proofs, real fees, several minutes).\n' +
        'Set BLACKOUT_TESTNET=1 to proceed, e.g.:\n' +
        '  BLACKOUT_TESTNET=1 pnpm --filter @zktable/blackout play',
    )
    process.exit(1)
  }

  const investigatorCount = process.env.BLACKOUT_INVESTIGATORS
    ? Number(process.env.BLACKOUT_INVESTIGATORS)
    : 2
  const scriptedRound = process.env.BLACKOUT_SCRIPTED_CAPTURE_ROUND
    ? Number(process.env.BLACKOUT_SCRIPTED_CAPTURE_ROUND)
    : undefined

  const transcript = await playBlackout({
    network: process.env.BLACKOUT_NETWORK ?? 'testnet',
    source: process.env.BLACKOUT_SOURCE ?? 'alice',
    investigatorCount,
    seed: process.env.BLACKOUT_SEED ?? `blackout-testnet-${Date.now()}`,
    scriptedCapture: scriptedRound !== undefined ? { round: scriptedRound, investigatorIndex: 0 } : undefined,
    log: (line) => console.log(line),
  })

  console.log('\n=== TRANSCRIPT ===')
  console.log(JSON.stringify(transcript, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
