// Default tool/artifact locations, resolved relative to this package so the
// module works regardless of the caller's cwd (mirrors
// `@zktable/circuits/src/paths.ts`).

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Root of the zkTable monorepo (parent of `packages/` and `games/`). */
export const REPO_ROOT = path.resolve(here, '../../..')

export const CONTRACTS_WASM_DIR = path.join(
  REPO_ROOT,
  'packages/contracts/target/wasm32v1-none/release',
)
export const DEFAULT_VERIFIER_WASM = path.join(CONTRACTS_WASM_DIR, 'zktable_verifier.wasm')
export const DEFAULT_REFEREE_WASM = path.join(CONTRACTS_WASM_DIR, 'zktable_referee.wasm')

export const CONTRACTS_DIR = path.join(REPO_ROOT, 'packages/contracts')
export const MOVE_ALONG_CIRCUIT_DIR = path.join(REPO_ROOT, 'packages/circuits/move_along')
export const MOVE_ALONG_TARGET_DIR = path.join(MOVE_ALONG_CIRCUIT_DIR, 'target')
export const DEFAULT_VK_PATH = path.join(MOVE_ALONG_TARGET_DIR, 'vk')
export const DEFAULT_BYTECODE_PATH = path.join(MOVE_ALONG_TARGET_DIR, 'move_along.json')

export const DEFAULT_STELLAR_BIN = 'stellar'
export const DEFAULT_NARGO_BIN = 'nargo'
export const DEFAULT_BB_BIN = 'bb'

/** `child_process` env with `~/.nargo/bin` and `~/.bb/bin` prepended to PATH. */
export function toolEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const extraDirs = [path.join(home, '.nargo', 'bin'), path.join(home, '.bb', 'bin')]
  const currentPath = process.env.PATH ?? ''
  return {
    ...process.env,
    PATH: [...extraDirs, currentPath].filter(Boolean).join(path.delimiter),
  }
}
