import { describe, expect, it, vi } from 'vitest'
import { RefereeCliError, stripHexPrefix, toBe32Hex } from './referee-client.js'

describe('stripHexPrefix', () => {
  it('removes a leading 0x', () => {
    expect(stripHexPrefix('0xabc123')).toBe('abc123')
  })

  it('leaves a string without 0x unchanged', () => {
    expect(stripHexPrefix('abc123')).toBe('abc123')
  })
})

describe('toBe32Hex', () => {
  it('encodes 999 as a zero-padded 32-byte (64 hex char) big-endian value', () => {
    expect(toBe32Hex(999n)).toBe('00000000000000000000000000000000000000000000000000000000000003e7')
  })

  it('encodes 0 as 64 zero chars', () => {
    expect(toBe32Hex(0n)).toBe('0'.repeat(64))
  })

  it('round-trips through BigInt parsing', () => {
    const value = 123456789012345n
    expect(BigInt('0x' + toBe32Hex(value))).toBe(value)
  })

  it('throws for a negative value', () => {
    expect(() => toBe32Hex(-1n)).toThrow(/non-negative/i)
  })

  it('throws when the value does not fit in 32 bytes', () => {
    expect(() => toBe32Hex(2n ** 257n)).toThrow(/32 bytes/i)
  })
})

describe('RefereeCliError', () => {
  it('parses a contract error code and known name out of stderr', () => {
    const stderr = '❌ error: transaction simulation failed: HostError: Error(Contract, #7)\n...'
    const err = new RefereeCliError(['contract', 'invoke'], stderr)
    expect(err.contractErrorCode).toBe(7)
    expect(err.contractErrorName).toBe('NotYourTurn')
    expect(err.message).toContain('NotYourTurn')
  })

  it('parses the VerificationFailed proof-binding error', () => {
    const stderr = 'HostError: Error(Contract, #13)'
    const err = new RefereeCliError(['contract', 'invoke'], stderr)
    expect(err.contractErrorCode).toBe(13)
    expect(err.contractErrorName).toBe('VerificationFailed')
  })

  it('parses the ClaimMismatch error', () => {
    const stderr = 'HostError: Error(Contract, #12)'
    const err = new RefereeCliError(['contract', 'invoke'], stderr)
    expect(err.contractErrorName).toBe('ClaimMismatch')
  })

  it('leaves contractErrorCode null when stderr has no contract error', () => {
    const err = new RefereeCliError(['contract', 'invoke'], 'connection reset by peer')
    expect(err.contractErrorCode).toBeNull()
    expect(err.contractErrorName).toBeNull()
  })

  it('handles an unrecognized error code gracefully', () => {
    const err = new RefereeCliError(['contract', 'invoke'], 'Error(Contract, #999)')
    expect(err.contractErrorCode).toBe(999)
    expect(err.contractErrorName).toBeNull()
  })
})

describe('per-seat signing (sourceForSeat)', () => {
  it("signs a seat's move with that seat's source and falls back to source otherwise", async () => {
    vi.resetModules()
    const execCalls: Array<{ bin: string; args: string[] }> = []
    vi.doMock('node:child_process', () => {
      const custom = Symbol.for('nodejs.util.promisify.custom')
      const execFile = (() => {
        throw new Error('callback-style execFile not expected')
      }) as unknown as Record<symbol, unknown>
      execFile[custom] = async (bin: string, args: string[]) => {
        execCalls.push({ bin, args })
        return { stdout: '', stderr: '' }
      }
      return { execFile }
    })
    const { CliRefereeClient: MockedClient } = await import('./referee-client.js')

    const client = new MockedClient({ sourceForSeat: { 1: 'seat1-key' } })
    await client.claim('CID', { player: 1, character: 2 })
    const args = execCalls.at(-1)!.args
    expect(args).toContain('claim')
    expect(args[args.indexOf('--source') + 1]).toBe('seat1-key')

    // A seat without a sourceForSeat entry falls back to the default source.
    const fallback = new MockedClient({ sourceForSeat: { 1: 'seat1-key' } })
    await fallback.claim('CID', { player: 0, character: 2 })
    expect(execCalls.at(-1)!.args[execCalls.at(-1)!.args.indexOf('--source') + 1]).toBe('alice')
    vi.doUnmock('node:child_process')
  })
})
