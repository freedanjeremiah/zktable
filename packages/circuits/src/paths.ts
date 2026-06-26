// Default tool/circuit locations, resolved relative to this package so the
// module works regardless of the caller's cwd.

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Root of the @zktable/circuits package (parent of src/). */
export const PACKAGE_ROOT = path.resolve(here, '..')

/** Directory of the `move_along` Noir circuit (Nargo.toml, target/, etc). */
export const DEFAULT_CIRCUIT_DIR = path.join(PACKAGE_ROOT, 'move_along')

/** Compiled circuit package name (matches move_along/Nargo.toml [package].name). */
export const CIRCUIT_PACKAGE_NAME = 'move_along'

/** Path to the zktable-graph Rust CLI binary, built by `cargo build --release`. */
export const DEFAULT_GRAPH_TOOLS_BIN = path.resolve(
  PACKAGE_ROOT,
  '../contracts/tools/graph-tools/target/release/zktable-graph',
)

export const DEFAULT_NARGO_BIN = 'nargo'
export const DEFAULT_BB_BIN = 'bb'

/**
 * `child_process` env with `~/.nargo/bin` and `~/.bb/bin` prepended to PATH,
 * so nargo/bb resolve even if the parent process's PATH lacks them.
 */
export function toolEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const extraDirs = [path.join(home, '.nargo', 'bin'), path.join(home, '.bb', 'bin')]
  const currentPath = process.env.PATH ?? ''
  return {
    ...process.env,
    PATH: [...extraDirs, currentPath].filter(Boolean).join(path.delimiter),
  }
}
