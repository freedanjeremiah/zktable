#!/usr/bin/env bash
# Deploy the UltraHonk verifier contract for a given circuit and verify its proof
# on Stellar testnet. Reproduces the zkTable M0 milestone end-to-end.
#
# Usage: ./deploy_verifier.sh <circuit-name> [source-account] [network]
#   circuit-name    directory under packages/circuits/ (must be built first)
#   source-account  stellar CLI identity (default: alice)
#   network         stellar network (default: testnet)
set -euo pipefail

CIRCUIT="${1:?usage: deploy_verifier.sh <circuit-name> [account] [network]}"
ACCOUNT="${2:-alice}"
NETWORK="${3:-testnet}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${CONTRACTS_DIR}/../.." && pwd)"
CIRC_TARGET="${REPO_ROOT}/packages/circuits/${CIRCUIT}/target"
WASM="${CONTRACTS_DIR}/target/wasm32v1-none/release/zktable_verifier.wasm"

hexify() { xxd -p -c 999999 "$1" | tr -d '\n'; }

for f in vk proof public_inputs; do
  [[ -f "${CIRC_TARGET}/${f}" ]] || {
    echo "missing ${CIRC_TARGET}/${f} — build the circuit first (packages/circuits/scripts/build_one.sh ${CIRCUIT})" >&2
    exit 1
  }
done

echo "• building verifier contract (wasm32v1-none)"
( cd "${CONTRACTS_DIR}" && cargo +stable build --release --target wasm32v1-none --package zktable-verifier )

echo "• funding ${ACCOUNT} on ${NETWORK}"
stellar keys fund "${ACCOUNT}" --network "${NETWORK}" 2>/dev/null || true

echo "• deploying verifier with VK for circuit '${CIRCUIT}'"
CID=$(stellar contract deploy --wasm "${WASM}" --source "${ACCOUNT}" --network "${NETWORK}" \
  -- --vk-bytes "$(hexify "${CIRC_TARGET}/vk")" | tail -n1)
echo "  contract: ${CID}"

echo "• verifying proof on-chain (expect: null / success)"
stellar contract invoke --id "${CID}" --source "${ACCOUNT}" --network "${NETWORK}" \
  -- verify_proof \
  --public-inputs "$(hexify "${CIRC_TARGET}/public_inputs")" \
  --proof-bytes "$(hexify "${CIRC_TARGET}/proof")"

echo "✅ ${CIRCUIT} proof verified on-chain by contract ${CID}"
echo "${CID}"
