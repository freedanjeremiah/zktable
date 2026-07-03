use soroban_sdk::{testutils::Ledger, Bytes, Env};
use std::{fs, path::Path};
use ultrahonk_soroban_verifier::UltraHonkVerifier;

fn run(dir: &str) -> Result<(), String> {
    let path = Path::new(dir);
    let env = Env::default();
    env.ledger().set_protocol_version(26);
    env.cost_estimate().budget().reset_unlimited();

    // Proof bytes
    let proof_bytes: Vec<u8> = fs::read(path.join("proof")).map_err(|e| e.to_string())?;
    let proof = Bytes::from_slice(&env, &proof_bytes);

    // Use binary VK
    let vk_bytes = fs::read(path.join("vk")).map_err(|e| e.to_string())?;
    let vk = Bytes::from_slice(&env, &vk_bytes);
    let verifier = UltraHonkVerifier::new(&env, &vk).map_err(|e| format!("{e:?}"))?;

    // Public inputs bytes
    let public_inputs = fs::read(path.join("public_inputs")).map_err(|e| e.to_string())?;
    let public_inputs = Bytes::from_slice(&env, &public_inputs);
    verifier
        .verify(&env, &proof, &public_inputs)
        .map_err(|e| format!("{e:?}"))?;
    Ok(())
}

// Circuits live at the monorepo's packages/circuits/. Build them first
// (packages/circuits/scripts/build_one.sh <name>). Paths are anchored to
// CARGO_MANIFEST_DIR so they are independent of the test's working directory.
#[test]
fn simple_circuit_proof_verifies() -> Result<(), String> {
    run(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../circuits/simple_circuit/target"))
}

#[test]
fn fib_chain_proof_verifies() -> Result<(), String> {
    run(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../circuits/fib_chain/target"))
}
