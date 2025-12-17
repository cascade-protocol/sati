//! Compute unit benchmarks for SATI Registry instructions
//!
//! Run with: cargo bench
//! Results written to: docs/benchmarks/compute_units.md
//!
//! Benchmark cases cover:
//! - Protocol initialization (initialize)
//! - Authority management (update_registry_authority)
//! - Agent registration with varying metadata sizes
//! - Soulbound (non-transferable) agent registration

#[path = "../tests/helpers/mod.rs"]
mod helpers;

use {
    helpers::{
        accounts::{program_account, system_account},
        instructions::{
            build_initialize, build_register_agent, build_update_registry_authority,
            derive_ata_token2022, derive_group_mint, derive_registry_config, PROGRAM_ID,
        },
        serialization::{serialize_registry_config, REGISTRY_CONFIG_SIZE},
        setup_mollusk,
    },
    mollusk_svm_bencher::MolluskComputeUnitBencher,
    mollusk_svm_programs_token::{associated_token, token2022},
    solana_sdk::{pubkey::Pubkey, rent::Rent, signature::Keypair, signer::Signer},
    solana_system_interface::program as system_program,
    spl_token_2022::{
        extension::{
            group_pointer::GroupPointer, BaseStateWithExtensionsMut, ExtensionType,
            StateWithExtensionsMut,
        },
        state::Mint,
    },
    spl_token_group_interface::state::TokenGroup,
};

/// Serialize a Token-2022 mint with GroupPointer and TokenGroup extensions
fn serialize_token2022_group_mint(
    group_mint_pubkey: Pubkey,
    mint_authority: Option<Pubkey>,
    update_authority: Pubkey,
    max_size: u64,
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
    token_group.max_size = max_size.into();

    state.pack_base();
    state.init_account_type().unwrap();

    data
}

fn main() {
    let mollusk = setup_mollusk();
    let rent = Rent::default();

    // ============================================
    // Benchmark: initialize
    // ============================================
    let (init_ix, init_accounts) = {
        let authority = Pubkey::new_unique();
        let (registry_config, _bump) = derive_registry_config();
        let group_mint = Pubkey::new_unique();

        // Create pre-initialized group mint (client responsibility)
        // The initialize instruction transfers mint authority to registry PDA
        let group_mint_data = serialize_token2022_group_mint(
            group_mint,
            Some(authority), // mint authority starts with caller
            registry_config, // update authority = registry PDA
            u64::MAX,        // unlimited
        );
        let group_mint_lamports = rent.minimum_balance(group_mint_data.len());

        let instruction = build_initialize(authority, registry_config, group_mint);

        let accounts = vec![
            (authority, system_account(10_000_000_000)),
            (registry_config, system_account(0)),
            (
                group_mint,
                program_account(group_mint_lamports, group_mint_data, token2022::ID),
            ),
            (
                system_program::id(),
                solana_sdk::account::Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: update_registry_authority (transfer)
    // ============================================
    let (transfer_auth_ix, transfer_auth_accounts) = {
        let authority = Pubkey::new_unique();
        let new_authority = Pubkey::new_unique();
        let (registry_config, bump) = derive_registry_config();
        let (group_mint, _) = derive_group_mint();

        let registry_data = serialize_registry_config(group_mint, authority, 0, bump);
        let registry_lamports = rent.minimum_balance(REGISTRY_CONFIG_SIZE);

        let instruction =
            build_update_registry_authority(authority, registry_config, Some(new_authority));

        let accounts = vec![
            (authority, system_account(1_000_000)),
            (
                registry_config,
                program_account(registry_lamports, registry_data, PROGRAM_ID),
            ),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: update_registry_authority (renounce)
    // ============================================
    let (renounce_auth_ix, renounce_auth_accounts) = {
        let authority = Pubkey::new_unique();
        let (registry_config, bump) = derive_registry_config();
        let (group_mint, _) = derive_group_mint();

        let registry_data = serialize_registry_config(group_mint, authority, 0, bump);
        let registry_lamports = rent.minimum_balance(REGISTRY_CONFIG_SIZE);

        let instruction = build_update_registry_authority(authority, registry_config, None);

        let accounts = vec![
            (authority, system_account(1_000_000)),
            (
                registry_config,
                program_account(registry_lamports, registry_data, PROGRAM_ID),
            ),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: register_agent (minimal - no additional metadata)
    // ============================================
    let (register_minimal_ix, register_minimal_accounts) = {
        let payer = Pubkey::new_unique();
        let owner = payer;
        let (registry_config, bump) = derive_registry_config();
        let group_mint = Pubkey::new_unique();
        let agent_mint = Keypair::new();
        let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

        let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
        let registry_lamports = rent.minimum_balance(REGISTRY_CONFIG_SIZE);

        let group_mint_data = serialize_token2022_group_mint(
            group_mint,
            Some(registry_config),
            registry_config,
            u64::MAX,
        );
        let group_mint_lamports = rent.minimum_balance(group_mint_data.len());

        let instruction = build_register_agent(
            payer,
            owner,
            registry_config,
            group_mint,
            agent_mint.pubkey(),
            agent_token_account,
            "Agent", // short name
            "AGNT",  // short symbol
            "https://sati.fyi/agent.json",
            None,  // no additional metadata
            false, // transferable
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
            token2022::keyed_account(),
            associated_token::keyed_account(),
            (
                system_program::id(),
                solana_sdk::account::Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: register_agent (typical - 3 metadata fields)
    // ============================================
    let (register_typical_ix, register_typical_accounts) = {
        let payer = Pubkey::new_unique();
        let owner = payer;
        let (registry_config, bump) = derive_registry_config();
        let group_mint = Pubkey::new_unique();
        let agent_mint = Keypair::new();
        let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

        let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
        let registry_lamports = rent.minimum_balance(REGISTRY_CONFIG_SIZE);

        let group_mint_data = serialize_token2022_group_mint(
            group_mint,
            Some(registry_config),
            registry_config,
            u64::MAX,
        );
        let group_mint_lamports = rent.minimum_balance(group_mint_data.len());

        let metadata = vec![
            ("version".to_string(), "1.0.0".to_string()),
            ("framework".to_string(), "claude".to_string()),
            ("capabilities".to_string(), "text,code".to_string()),
        ];

        let instruction = build_register_agent(
            payer,
            owner,
            registry_config,
            group_mint,
            agent_mint.pubkey(),
            agent_token_account,
            "MyAIAgent",
            "MYAI",
            "https://sati.fyi/agents/my-agent.json",
            Some(&metadata),
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
            token2022::keyed_account(),
            associated_token::keyed_account(),
            (
                system_program::id(),
                solana_sdk::account::Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: register_agent (maximum - 10 metadata fields)
    // ============================================
    let (register_max_ix, register_max_accounts) = {
        let payer = Pubkey::new_unique();
        let owner = payer;
        let (registry_config, bump) = derive_registry_config();
        let group_mint = Pubkey::new_unique();
        let agent_mint = Keypair::new();
        let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

        let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
        let registry_lamports = rent.minimum_balance(REGISTRY_CONFIG_SIZE);

        let group_mint_data = serialize_token2022_group_mint(
            group_mint,
            Some(registry_config),
            registry_config,
            u64::MAX,
        );
        let group_mint_lamports = rent.minimum_balance(group_mint_data.len());

        // Maximum 10 metadata entries with realistic lengths
        let metadata: Vec<(String, String)> = (0..10)
            .map(|i| {
                (
                    format!("field_{}", i),
                    format!("value_for_field_{}_with_some_content", i),
                )
            })
            .collect();

        let instruction = build_register_agent(
            payer,
            owner,
            registry_config,
            group_mint,
            agent_mint.pubkey(),
            agent_token_account,
            "MaxMetadataAgent",
            "MAXAGENT",
            "https://sati.fyi/agents/max-metadata-agent.json",
            Some(&metadata),
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
            token2022::keyed_account(),
            associated_token::keyed_account(),
            (
                system_program::id(),
                solana_sdk::account::Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
        ];

        (instruction, accounts)
    };

    // ============================================
    // Benchmark: register_agent (soulbound - non-transferable)
    // ============================================
    let (register_soulbound_ix, register_soulbound_accounts) = {
        let payer = Pubkey::new_unique();
        let owner = payer;
        let (registry_config, bump) = derive_registry_config();
        let group_mint = Pubkey::new_unique();
        let agent_mint = Keypair::new();
        let agent_token_account = derive_ata_token2022(&owner, &agent_mint.pubkey());

        let registry_data = serialize_registry_config(group_mint, payer, 0, bump);
        let registry_lamports = rent.minimum_balance(REGISTRY_CONFIG_SIZE);

        let group_mint_data = serialize_token2022_group_mint(
            group_mint,
            Some(registry_config),
            registry_config,
            u64::MAX,
        );
        let group_mint_lamports = rent.minimum_balance(group_mint_data.len());

        let instruction = build_register_agent(
            payer,
            owner,
            registry_config,
            group_mint,
            agent_mint.pubkey(),
            agent_token_account,
            "SoulboundAgent",
            "SOUL",
            "https://sati.fyi/agents/soulbound.json",
            Some(&[("permanent".to_string(), "true".to_string())]),
            true, // non-transferable
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
            token2022::keyed_account(),
            associated_token::keyed_account(),
            (
                system_program::id(),
                solana_sdk::account::Account {
                    lamports: 1,
                    data: vec![],
                    owner: solana_sdk::native_loader::id(),
                    executable: true,
                    rent_epoch: 0,
                },
            ),
        ];

        (instruction, accounts)
    };

    // Output directory relative to workspace root
    let out_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // programs/
        .unwrap()
        .parent() // workspace root
        .unwrap()
        .join("docs/benchmarks");

    // Ensure output directory exists
    std::fs::create_dir_all(&out_dir).expect("Failed to create output directory");

    // Run all benchmarks
    MolluskComputeUnitBencher::new(mollusk)
        // Protocol setup
        .bench(("initialize", &init_ix, &init_accounts))
        // Authority management
        .bench((
            "update_registry_authority_transfer",
            &transfer_auth_ix,
            &transfer_auth_accounts,
        ))
        .bench((
            "update_registry_authority_renounce",
            &renounce_auth_ix,
            &renounce_auth_accounts,
        ))
        // Agent registration - scaling by metadata
        .bench((
            "register_agent_minimal",
            &register_minimal_ix,
            &register_minimal_accounts,
        ))
        .bench((
            "register_agent_typical_3_fields",
            &register_typical_ix,
            &register_typical_accounts,
        ))
        .bench((
            "register_agent_max_10_fields",
            &register_max_ix,
            &register_max_accounts,
        ))
        // Soulbound variant
        .bench((
            "register_agent_soulbound",
            &register_soulbound_ix,
            &register_soulbound_accounts,
        ))
        .must_pass(true)
        .out_dir(out_dir.to_str().unwrap())
        .execute();
}
