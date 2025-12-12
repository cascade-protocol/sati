//! Error code re-exports from the program
//!
//! We re-export the program's SatiError enum for use in tests.
//! Anchor custom errors start at 6000.
//!
//! These helpers are shared across multiple test files. Each test binary
//! only uses a subset, so dead_code warnings are expected and suppressed.

#![allow(dead_code)]

pub use sati_registry::errors::SatiError;

/// Convert SatiError to u32 for ProgramError::Custom
pub fn error_code(code: SatiError) -> u32 {
    // Anchor error codes start at 6000
    6000 + code as u32
}
