use litesvm::LiteSVM;
use solana_sdk::{pubkey::Pubkey, signature::Keypair};
use std::path::PathBuf;

// Light Protocol imports for compressed account testing
pub use light_program_test::{
    indexer::{TestIndexer, TestIndexerExtensions},
    program_test::LightProgramTest,
    ProgramTestConfig,
    Rpc, // Trait for get_payer() and other RPC methods
};

/// SATI program ID (matches declare_id! in lib.rs)
pub const SATI_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe");

/// Token-2022 program ID
pub const TOKEN_2022_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/// Associated Token Account program ID
pub const ATA_PROGRAM_ID: Pubkey =
    solana_sdk::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/// Find the SATI program .so file
fn find_program_file() -> PathBuf {
    // Try multiple locations
    let possible_paths = [
        PathBuf::from("../../target/deploy/sati.so"),
        PathBuf::from("target/deploy/sati.so"),
        PathBuf::from("../target/deploy/sati.so"),
    ];

    for path in &possible_paths {
        if path.exists() {
            return path.clone();
        }
    }

    // Default to standard path
    PathBuf::from("../../target/deploy/sati.so")
}

/// Initialize LiteSVM with SATI program and Token-2022
pub fn setup_litesvm() -> LiteSVM {
    let mut svm = LiteSVM::new();

    // Load SATI program
    let program_path = find_program_file();
    svm.add_program_from_file(SATI_PROGRAM_ID, program_path.to_str().unwrap())
        .expect("Failed to load SATI program. Run 'anchor build' first.");

    svm
}

/// Get minimum rent-exempt balance for a given account size
pub fn get_rent_exempt_balance(svm: &LiteSVM, space: usize) -> u64 {
    svm.minimum_balance_for_rent_exemption(space)
}

/// Derive registry config PDA
pub fn derive_registry_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"registry"], &SATI_PROGRAM_ID)
}

/// Derive schema config PDA
pub fn derive_schema_config_pda(sas_schema: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"schema_config", sas_schema.as_ref()], &SATI_PROGRAM_ID)
}

/// Derive SATI attestation PDA (for SAS CPI authority)
pub fn derive_sati_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"sati_attestation"], &SATI_PROGRAM_ID)
}

// ============================================================================
// Light Protocol Test Setup (for compressed attestation tests)
// ============================================================================

/// Light Protocol test environment with SATI program loaded
pub struct LightTestEnv {
    pub rpc: LightProgramTest,
    pub indexer: TestIndexer,
    pub payer: Keypair,
}

/// Initialize Light Protocol test environment with SATI program
///
/// This sets up:
/// - LightProgramTest with V1 state/address trees
/// - TestIndexer for tracking compressed accounts and generating proofs
/// - Funded payer keypair
///
/// **Prerequisites:**
/// 1. Start localnet: `pnpm localnet`
/// 2. Run tests: `cargo test -p sati --test main attestation::`
pub async fn setup_light_test_env() -> LightTestEnv {
    // Set SBF_OUT_DIR so light-program-test can find our program binary
    if std::env::var("SBF_OUT_DIR").is_err() {
        // Try to find target/deploy relative to the workspace root
        let deploy_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent() // programs
            .and_then(|p| p.parent()) // workspace root
            .map(|p| p.join("target/deploy"))
            .expect("Failed to find workspace root");

        std::env::set_var("SBF_OUT_DIR", deploy_dir);
    }

    let mut config = ProgramTestConfig::new(
        false, // use_batched_trees - use V1 trees for simpler setup
        Some(vec![("sati", SATI_PROGRAM_ID)]),
    );
    // Enable prover - requires localnet running
    config.with_prover = true;

    let rpc = LightProgramTest::new(config).await.expect(
        "Failed to setup Light Protocol test environment. \
                 Make sure to run `pnpm localnet` first.",
    );

    let env = rpc.test_accounts.clone();
    let payer = rpc.get_payer().insecure_clone();
    let indexer = TestIndexer::init_from_acounts(&payer, &env, 0).await;

    LightTestEnv {
        rpc,
        indexer,
        payer,
    }
}
