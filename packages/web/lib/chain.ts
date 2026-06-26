/**
 * Real on-chain evidence for this build: the generic Soroban referee
 * contract from M0–M3, deployed and verifying proofs on Stellar testnet.
 * M4b/M4c will read/write against it; the shell only links to it as proof
 * the ZK claims on this site aren't aspirational.
 */
export const REFEREE_CONTRACT_ID =
  "CBYJDNG5OIBQDTLRX45ECUOT6JLB6NO2ALVY4F7DU6UGN4PVKJRVWPAG";

export const REFEREE_CONTRACT_EXPLORER_URL = `https://stellar.expert/explorer/testnet/contract/${REFEREE_CONTRACT_ID}`;
