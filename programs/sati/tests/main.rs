//! SATI Program Integration Tests
//!
//! Uses LiteSVM for fast in-process testing of the SATI program.
//!
//! ## Test Organization
//!
//! - `registry/` - Tests for registry instructions (initialize, register_agent, etc.)
//! - `attestation/` - Tests for attestation instructions (create, close)
//!
//! ## Running Tests
//!
//! ```bash
//! # Build the program first
//! anchor build
//!
//! # Run all tests
//! cargo test -p sati --test main
//!
//! # Run registry tests only
//! cargo test -p sati --test main registry::
//!
//! # Run a specific test
//! cargo test -p sati --test main test_initialize_success
//! ```

mod common;
mod registry;
mod attestation;

pub use common::*;
