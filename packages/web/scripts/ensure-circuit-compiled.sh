#!/usr/bin/env bash
# Ensures the move_along ACIR artifact exists before the web build copies it
# into public/. On Vercel (and any CI without the Noir toolchain) this installs
# nargo on demand and compiles the circuit. Self-healing: if the artifact is
# already present (local dev, warm cache) it does nothing.
set -euo pipefail

NOIR_VERSION="1.0.0-beta.9"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUIT_DIR="$(cd "${SCRIPT_DIR}/../../circuits/move_along" && pwd)"
ART="${CIRCUIT_DIR}/target/move_along.json"

if [[ -f "${ART}" ]]; then
  echo "[ensure-circuit] ${ART#"${SCRIPT_DIR}/"} already present — skip compile"
  exit 0
fi

export PATH="${HOME}/.nargo/bin:${PATH}"

if ! command -v nargo >/dev/null 2>&1; then
  echo "[ensure-circuit] installing nargo ${NOIR_VERSION}"
  curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | \
    NOIR_VERSION="${NOIR_VERSION}" bash
  export PATH="${HOME}/.nargo/bin:${PATH}"
  noirup -v "${NOIR_VERSION}"
fi

echo "[ensure-circuit] compiling move_along with $(nargo --version | head -n1)"
( cd "${CIRCUIT_DIR}" && nargo compile )

if [[ ! -f "${ART}" ]]; then
  echo "[ensure-circuit] compile finished but ${ART} missing" >&2
  exit 1
fi
echo "[ensure-circuit] compiled ${ART}"
