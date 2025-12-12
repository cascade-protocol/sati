//! Test helpers for SATI Registry Mollusk tests

pub mod accounts;
pub mod errors;
pub mod instructions;
pub mod serialization;

use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::{associated_token, token2022};

/// Setup Mollusk for testing with Token-2022 program
///
/// Uses SBF_OUT_DIR to tell Mollusk where to find the program binary.
/// For Anchor workspace: tests are in programs/sati-registry/tests,
/// binary is at workspace_root/target/deploy/
pub fn setup_mollusk() -> Mollusk {
    // Set SBF_OUT_DIR to the deploy directory
    // From programs/sati-registry/, go up 2 levels to workspace root
    let deploy_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // programs/
        .unwrap()
        .parent() // workspace root
        .unwrap()
        .join("target/deploy");

    std::env::set_var("SBF_OUT_DIR", deploy_dir);

    // Create mollusk with our program
    let mut mollusk = Mollusk::new(&instructions::PROGRAM_ID, "sati_registry");

    // Add Token-2022 program (required for SATI)
    token2022::add_program(&mut mollusk);

    // Add Associated Token program (required for ATA creation)
    associated_token::add_program(&mut mollusk);

    mollusk
}
