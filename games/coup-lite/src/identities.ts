// Multi-identity helpers for per-seat transaction signing (M8.1).
//
// With `require_auth()` live in the referee, each seat's moves must be
// signed by the seat's own address. The default demo keeps one funded
// identity owning every seat (auth passes trivially); `multiSeat` mode
// provisions one funded testnet identity per seat to demonstrate genuine
// multi-wallet play.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DEFAULT_STELLAR_BIN, toolEnv } from './paths.js'

const execFileAsync = promisify(execFile)

/**
 * Seat index -> CLI identity name. Single-identity mode maps every seat to
 * `source`; multi-seat mode gives seat 0 `source` and each later seat a
 * derived `${source}-seat<i>` identity.
 */
export function seatIdentityNames(source: string, nSeats: number, multiSeat: boolean): string[] {
  if (!multiSeat) return Array.from({ length: nSeats }, () => source)
  return Array.from({ length: nSeats }, (_, i) => (i === 0 ? source : `${source}-seat${i}`))
}

/** Ensures a funded testnet identity exists for each name; returns name -> G-address. */
export async function ensureIdentities(
  names: string[],
  stellarBin = DEFAULT_STELLAR_BIN,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const name of [...new Set(names)]) {
    try {
      await execFileAsync(stellarBin, ['keys', 'address', name], { env: toolEnv() })
    } catch {
      await execFileAsync(stellarBin, ['keys', 'generate', name, '--network', 'testnet', '--fund'], {
        env: toolEnv(),
      })
    }
    const { stdout } = await execFileAsync(stellarBin, ['keys', 'address', name], { env: toolEnv() })
    out[name] = stdout.trim()
  }
  return out
}
