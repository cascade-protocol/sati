//! State verification tests for SATI Registry
//!
//! These tests verify that state is correctly modified after successful instructions.
//! They go beyond success/failure checks to verify actual account data changes.

mod helpers;

use helpers::{
    accounts::{
        program_account, system_account, system_program_account, token2022_program_account,
    },
    instructions::{
        build_register_agent, build_update_registry_authority, derive_ata_token2022,
        derive_registry_config, PROGRAM_ID,
    },
    serialization::{
        serialize_registry_config, REGISTRY_CONFIG_DISCRIMINATOR, REGISTRY_CONFIG_SIZE,
    },
    setup_mollusk,
};
use mollusk_svm::result::Check;
use mollusk_svm_programs_token::{associated_token, token2022};
use solana_sdk::{pubkey::Pubkey, rent::Rent, signature::Keypair, signer::Signer};
use spl_token_2022::{
    extension::{
        group_pointer::GroupPointer, BaseStateWithExtensionsMut, ExtensionType,
        StateWithExtensionsMut,
    },
    state::Mint,
};
use spl_token_group_interface::state::TokenGroup;

/// Deserialize RegistryConfig from account data
fn deserialize_registry_config(data: &[u8]) -> (Pubkey, Pubkey, u64, u8) {
    assert!(data.len() >= REGISTRY_CONFIG_SIZE);
    assert_eq!(&data[0..8], &REGISTRY_CONFIG_DISCRIMINATOR);

    let group_mint = Pubkey::try_from(&data[8..40]).unwrap();
    let authority = Pubkey::try_from(&data[40..72]).unwrap();
    let total_agents = u64::from_le_bytes(data[72..80].try_into().unwrap());
    let bump = data[80];

    (group_mint, authority, total_agents, bump)
}

/// Serialize a Token-2022 group mint with configurable parameters
fn serialize_token2022_group_mint(
    group_mint_pubkey: Pubkey,
    mint_authority: Option<Pubkey>,
    update_authority: Pubkey,
    max_size: u32,
) -> Vec<u8> {
    let extensions = [ExtensionType::GroupPointer, ExtensionType::TokenGroup];
    let space = ExtensionType::try_calculate_account_len::<Mint>(&extensions).unwrap();
    let mut data = vec![0u8; space];

    let mut state = StateWithExtensionsMut::<Mint>::unpack_uninitialized(&mut data).unwrap();

    state.base.mint_authority = mint_authority.into();
    state.base.supply = 0;
    state.base.decimals = 0;
    state.base.is_initialized = true;
    state.base.freeze_authority = None.into();

    let group_pointer = state.init_extension::<GroupPointer>(true).unwrap();
    group_pointer.authority = Some(update_authority).try_into().unwrap();
    group_pointer.group_address = Some(group_mint_pubkey).try_into().unwrap();

    let token_group = state.init_extension::<TokenGroup>(true).unwrap();
    token_group.update_authority = Some(update_authority).try_into().unwrap();
    token_group.mint = group_mint_pubkey;
    token_group.size = 0.into();
    token_group.max_size = (max_size as u64).into();

    state.pack_base();
    state.init_account_type().unwrap();

    data
}

// =============================================================================
// CRITICAL: Counter Increment Tests
// =============================================================================

#[test]
fn test_register_agent_counter_increments_from_zero() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Start with total_agents = 0
    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "Agent1",
        "AGT1",
        "https://example.com/1.json",
        None,
        false,
    );

    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Instruction failed: {:?}",
        result.program_result
    );

    // Verify counter incremented from 0 to 1
    let registry_account = result
        .get_account(&registry_config)
        .expect("Registry config not found");
    let (_, _, total_agents, _) = deserialize_registry_config(&registry_account.data);
    assert_eq!(
        total_agents, 1,
        "Counter should be 1 after first registration"
    );
}

#[test]
fn test_register_agent_counter_increments_from_nonzero() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Start with total_agents = 42
    let registry_data = serialize_registry_config(group_mint, payer, 42, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "Agent43",
        "AGT43",
        "https://example.com/43.json",
        None,
        false,
    );

    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Instruction failed: {:?}",
        result.program_result
    );

    // Verify counter incremented from 42 to 43
    let registry_account = result
        .get_account(&registry_config)
        .expect("Registry config not found");
    let (_, _, total_agents, _) = deserialize_registry_config(&registry_account.data);
    assert_eq!(
        total_agents, 43,
        "Counter should be 43 after registration (was 42)"
    );
}

#[test]
fn test_register_agent_counter_overflow_fails() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    // Start with total_agents = u64::MAX (will overflow on +1)
    let registry_data = serialize_registry_config(group_mint, payer, u64::MAX, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "OverflowAgent",
        "OVR",
        "https://example.com/overflow.json",
        None,
        false,
    );

    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    // Should fail with Overflow error (6009)
    let checks = vec![Check::err(solana_sdk::program_error::ProgramError::Custom(
        6009,
    ))];

    mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
}

// =============================================================================
// CRITICAL: Update Authority State Verification
// =============================================================================

#[test]
fn test_update_authority_transfer_updates_state() {
    let mollusk = setup_mollusk();

    let authority = Pubkey::new_unique();
    let new_authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    let registry_data = serialize_registry_config(group_mint, authority, 5, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let instruction =
        build_update_registry_authority(authority, registry_config, Some(new_authority));

    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Instruction failed: {:?}",
        result.program_result
    );

    // Verify authority changed to new_authority
    let registry_account = result
        .get_account(&registry_config)
        .expect("Registry config not found");
    let (stored_group_mint, stored_authority, stored_total_agents, stored_bump) =
        deserialize_registry_config(&registry_account.data);

    assert_eq!(
        stored_authority, new_authority,
        "Authority should be updated"
    );
    // Verify other fields unchanged
    assert_eq!(
        stored_group_mint, group_mint,
        "group_mint should be unchanged"
    );
    assert_eq!(stored_total_agents, 5, "total_agents should be unchanged");
    assert_eq!(stored_bump, bump, "bump should be unchanged");
}

#[test]
fn test_update_authority_renounce_updates_state() {
    let mollusk = setup_mollusk();

    let authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    let registry_data = serialize_registry_config(group_mint, authority, 10, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    // None = renounce
    let instruction = build_update_registry_authority(authority, registry_config, None);

    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Instruction failed: {:?}",
        result.program_result
    );

    // Verify authority is now Pubkey::default() (immutable)
    let registry_account = result
        .get_account(&registry_config)
        .expect("Registry config not found");
    let (stored_group_mint, stored_authority, stored_total_agents, stored_bump) =
        deserialize_registry_config(&registry_account.data);

    assert_eq!(
        stored_authority,
        Pubkey::default(),
        "Authority should be default (immutable)"
    );
    // Verify other fields unchanged
    assert_eq!(
        stored_group_mint, group_mint,
        "group_mint should be unchanged"
    );
    assert_eq!(stored_total_agents, 10, "total_agents should be unchanged");
    assert_eq!(stored_bump, bump, "bump should be unchanged");
}

#[test]
fn test_update_authority_transfer_to_self_succeeds() {
    let mollusk = setup_mollusk();

    let authority = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    let registry_data = serialize_registry_config(group_mint, authority, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    // Transfer to self (no-op)
    let instruction = build_update_registry_authority(authority, registry_config, Some(authority));

    let accounts = vec![
        (authority, system_account(10_000_000_000)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Transfer to self should succeed: {:?}",
        result.program_result
    );

    // Verify authority remains the same
    let registry_account = result
        .get_account(&registry_config)
        .expect("Registry config not found");
    let (_, stored_authority, _, _) = deserialize_registry_config(&registry_account.data);

    assert_eq!(
        stored_authority, authority,
        "Authority should remain unchanged"
    );
}

// =============================================================================
// MEDIUM: Sequential Authority Transfers
// =============================================================================

#[test]
fn test_update_authority_sequential_transfers() {
    let mollusk = setup_mollusk();

    let authority_a = Pubkey::new_unique();
    let authority_b = Pubkey::new_unique();
    let authority_c = Pubkey::new_unique();
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();

    // Initial state: authority = A
    let registry_data = serialize_registry_config(group_mint, authority_a, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    // === Transfer A -> B ===
    let instruction1 =
        build_update_registry_authority(authority_a, registry_config, Some(authority_b));

    let accounts1 = vec![
        (authority_a, system_account(10_000_000_000)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
    ];

    let result1 = mollusk.process_instruction(&instruction1, &accounts1);
    assert!(
        result1.program_result.is_ok(),
        "Transfer A->B failed: {:?}",
        result1.program_result
    );

    // Get updated registry data
    let registry_account1 = result1.get_account(&registry_config).unwrap();
    let updated_data1 = registry_account1.data.clone();

    // === Transfer B -> C ===
    let instruction2 =
        build_update_registry_authority(authority_b, registry_config, Some(authority_c));

    let accounts2 = vec![
        (authority_b, system_account(10_000_000_000)),
        (
            registry_config,
            program_account(registry_lamports, updated_data1, PROGRAM_ID),
        ),
    ];

    let result2 = mollusk.process_instruction(&instruction2, &accounts2);
    assert!(
        result2.program_result.is_ok(),
        "Transfer B->C failed: {:?}",
        result2.program_result
    );

    // Verify final authority is C
    let registry_account2 = result2.get_account(&registry_config).unwrap();
    let (_, final_authority, _, _) = deserialize_registry_config(&registry_account2.data);
    assert_eq!(final_authority, authority_c, "Final authority should be C");
}

// =============================================================================
// HIGH: Owner vs Payer Separation
// =============================================================================

#[test]
fn test_register_agent_owner_differs_from_payer() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = Pubkey::new_unique(); // Different from payer!
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    // ATA should be derived for OWNER, not payer
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "OwnedAgent",
        "OWN",
        "https://example.com/owned.json",
        None,
        false,
    );

    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)), // Owner doesn't need lamports
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Register with different owner should succeed: {:?}",
        result.program_result
    );

    // Counter should still increment
    let registry_account = result
        .get_account(&registry_config)
        .expect("Registry config not found");
    let (_, _, total_agents, _) = deserialize_registry_config(&registry_account.data);
    assert_eq!(total_agents, 1, "Counter should be 1");
}

// =============================================================================
// HIGH: Non-Transferable Flag
// =============================================================================

#[test]
fn test_register_agent_non_transferable_succeeds() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "SoulboundAgent",
        "SOUL",
        "https://example.com/soulbound.json",
        None,
        true, // non_transferable = true
    );

    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Non-transferable agent should succeed: {:?}",
        result.program_result
    );

    // Verify counter incremented
    let registry_account = result
        .get_account(&registry_config)
        .expect("Registry config not found");
    let (_, _, total_agents, _) = deserialize_registry_config(&registry_account.data);
    assert_eq!(total_agents, 1, "Counter should be 1");
}

// =============================================================================
// CRITICAL: Mint Authority Renunciation (Supply=1 Guarantee)
// =============================================================================

/// Verifies that after register_agent, the agent mint's authority is renounced
/// and supply is exactly 1. This is critical for the NFT uniqueness guarantee.
#[test]
fn test_register_agent_mint_authority_renounced() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "TestAgent",
        "TAGT",
        "https://example.com/agent.json",
        None,
        false,
    );

    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Instruction failed: {:?}",
        result.program_result
    );

    // CRITICAL: Verify the agent mint's authority was renounced
    let agent_mint_account = result
        .get_account(&agent_mint.pubkey())
        .expect("Agent mint account not found");

    // Deserialize Token-2022 mint state with extensions
    let mut mint_data = agent_mint_account.data.clone();
    let mint_state = StateWithExtensionsMut::<Mint>::unpack(&mut mint_data)
        .expect("Failed to unpack agent mint");

    // 1. Mint authority MUST be None (renounced) - this ensures supply=1 forever
    assert!(
        mint_state.base.mint_authority.is_none(),
        "SECURITY VIOLATION: Mint authority must be renounced (None) after registration"
    );

    // 2. Supply MUST be exactly 1
    assert_eq!(
        mint_state.base.supply, 1,
        "Supply must be exactly 1 for NFT uniqueness"
    );

    // 3. Decimals must be 0 (NFT standard)
    assert_eq!(mint_state.base.decimals, 0, "Decimals must be 0 for NFT");
}

/// Verifies mint authority renunciation for non-transferable (soulbound) agents
#[test]
fn test_register_agent_non_transferable_mint_authority_renounced() {
    let mollusk = setup_mollusk();

    let payer = Pubkey::new_unique();
    let owner = payer;
    let (registry_config, bump) = derive_registry_config();
    let group_mint = Pubkey::new_unique();
    let agent_mint = Keypair::new();
    let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

    let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
    let registry_lamports = Rent::default().minimum_balance(REGISTRY_CONFIG_SIZE);

    let group_mint_data = serialize_token2022_group_mint(
        group_mint,
        Some(registry_config),
        registry_config,
        u32::MAX,
    );
    let group_mint_lamports = Rent::default().minimum_balance(group_mint_data.len());

    let instruction = build_register_agent(
        payer,
        owner,
        registry_config,
        group_mint,
        agent_mint.pubkey(),
        agent_token_account,
        "SoulboundAgent",
        "SOUL",
        "https://example.com/soulbound.json",
        None,
        true, // non_transferable = true
    );

    let accounts = vec![
        (payer, system_account(10_000_000_000)),
        (owner, system_account(0)),
        (
            registry_config,
            program_account(registry_lamports, registry_data, PROGRAM_ID),
        ),
        (
            group_mint,
            program_account(group_mint_lamports, group_mint_data, token2022::ID),
        ),
        (agent_mint.pubkey(), system_account(0)),
        (agent_token_account, system_account(0)),
        token2022_program_account(),
        associated_token::keyed_account(),
        system_program_account(),
    ];

    let result = mollusk.process_instruction(&instruction, &accounts);
    assert!(
        result.program_result.is_ok(),
        "Non-transferable registration failed: {:?}",
        result.program_result
    );

    // CRITICAL: Verify the agent mint's authority was renounced
    let agent_mint_account = result
        .get_account(&agent_mint.pubkey())
        .expect("Agent mint account not found");

    let mut mint_data = agent_mint_account.data.clone();
    let mint_state = StateWithExtensionsMut::<Mint>::unpack(&mut mint_data)
        .expect("Failed to unpack agent mint");

    // Mint authority MUST be None even for non-transferable agents
    assert!(
        mint_state.base.mint_authority.is_none(),
        "SECURITY VIOLATION: Non-transferable agent mint authority must be renounced"
    );

    assert_eq!(
        mint_state.base.supply, 1,
        "Supply must be exactly 1 for soulbound NFT"
    );
}
