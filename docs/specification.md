# SATI Specification v2.0

## Solana Agent Trust Infrastructure

**Status**: Implementation Ready
**Version**: 2.0.0
**Created**: 2025-12-11
**License**: Apache 2.0

---

## Abstract

SATI v2 is a lightweight agent trust infrastructure for Solana providing ERC-8004 compatible agent identity, reputation, and validation. It combines:

- **SATI Registry Program** - Minimal Anchor program for canonical address and atomic registration
- **Token-2022** for agent identity (NFTs with native metadata and collection membership)
- **Solana Attestation Service (SAS)** for reputation and validation attestations

This design achieves **100% ERC-8004 functional compatibility** with native wallet support, standard transfer semantics, and a canonical registry address.

---

## Table of Contents

1. [Motivation](#motivation)
2. [Architecture](#architecture)
3. [Registry Program](#registry-program)
4. [Identity: Token-2022 NFT](#identity-token-2022-nft)
5. [Reputation & Validation: SAS](#reputation--validation-sas)
6. [ERC-8004 Compatibility](#erc-8004-compatibility)
7. [SDK Interface](#sdk-interface)
8. [Security Considerations](#security-considerations)
9. [Development Environment](#development-environment)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [Governance](#governance)

---

## Motivation

### Why v2?

SATI v1 proposed multiple custom programs with ZK compression. Analysis revealed:

1. **Overcomplicated**: Custom programs add audit burden and attack surface
2. **Premature optimization**: ZK compression savings irrelevant at current scale
3. **Reinventing wheels**: Token-2022 + SAS already provide needed primitives
4. **Deferred features**: Mandate/AP2 lifecycle solves problems that don't exist yet

### Why a Registry Program?

ERC-8004 requires a canonical registry address per chain for discoverability. On Solana:

- Token-2022 TokenGroup requires `update_authority` to sign for membership
- Without a program, someone must manually co-sign every registration (centralized)
- A minimal program holds the authority as a PDA and provides atomic registration

The registry program is a **thin wrapper** (~500 lines) around Token-2022, not a replacement.

### Why Token-2022 for Identity?

ERC-8004 uses ERC-721 NFTs because they provide:
- **Browsability** - OpenSea, wallets show all NFTs
- **Transferability** - Standard `transferFrom()`
- **Metadata** - `tokenURI` points to registration file

On Solana, **Token-2022 achieves the same benefits**:
- **Wallet support** - Phantom, Solflare, Backpack display Token-2022 NFTs
- **Standard transfers** - Native token transfer instruction
- **TokenMetadata extension** - `name`, `symbol`, `uri`, `additionalMetadata`
- **TokenGroup extension** - Collections with auto-incrementing member IDs

### Design Principles

1. **Minimal custom code** - Thin registry wrapper + Token-2022 + SAS
2. **ERC-8004 compatible** - Same data model and registration file format
3. **Canonical address** - `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` vanity program ID for discoverability
4. **Wallet support out of the box** - Users see agents in their wallets
5. **Enterprise ready** - Works with Squads smart accounts
6. **Immutable governance** - Start with multisig, renounce to immutable after stable

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SATI Registry Program                        │
│           (satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF)          │
├─────────────────────────────────────────────────────────────────┤
│  initialize()              → Create registry + TokenGroup       │
│  register_agent()          → Token-2022 NFT + group membership  │
│  update_registry_authority() → Transfer/renounce control        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────┐  ┌──────────────────────────────────┐
│      Token-2022          │  │  Solana Attestation Service      │
│  • Identity storage      │  │  • FeedbackAuth schema           │
│  • TokenMetadata         │  │  • Feedback schema               │
│  • TokenGroup            │  │  • FeedbackResponse schema       │
│  • Direct updates/xfers  │  │  • ValidationRequest schema      │
└──────────────────────────┘  │  • ValidationResponse schema     │
                              └──────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **SATI Registry** | Canonical entry point, atomic registration, group authority |
| **Token-2022** | Identity storage, metadata, transfers (direct calls) |
| **SAS** | Reputation attestations, validation attestations |

---

## Registry Program

### Overview

The SATI Registry is a minimal Anchor program (~500 lines) that:
- Provides a **canonical program address** (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`)
- Holds TokenGroup `update_authority` as a PDA
- Enables **permissionless, atomic registration**
- Supports **governance lifecycle** (multisig → immutable)

### Program ID

```rust
declare_id!("satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF");
```

### Constants

```rust
/// Maximum length for agent name (bytes)
pub const MAX_NAME_LENGTH: usize = 32;

/// Maximum length for agent symbol (bytes)
pub const MAX_SYMBOL_LENGTH: usize = 10;

/// Maximum length for URI (bytes)
pub const MAX_URI_LENGTH: usize = 200;

/// Maximum number of additional metadata entries
pub const MAX_METADATA_ENTRIES: usize = 10;

/// Maximum length for metadata key (bytes)
pub const MAX_METADATA_KEY_LENGTH: usize = 32;

/// Maximum length for metadata value (bytes)
pub const MAX_METADATA_VALUE_LENGTH: usize = 200;
```

### PDA Seeds

| Account | Seeds | Description |
|---------|-------|-------------|
| `RegistryConfig` | `[b"registry"]` | Singleton registry configuration |

**Non-PDA Accounts:**
- `group_mint` - TokenGroup collection mint, created by client before `initialize()`
- Agent NFT mints - randomly generated keypairs for uniqueness

### Account Structures

```rust
use anchor_lang::prelude::*;

/// Registry configuration account
/// PDA seeds: [b"registry"]
#[account]
pub struct RegistryConfig {
    /// SATI TokenGroup mint address
    pub group_mint: Pubkey,

    /// Authority that can update registry settings
    /// Set to Pubkey::default() to make immutable
    pub authority: Pubkey,

    /// Total agents registered (counter)
    pub total_agents: u64,

    /// PDA bump seed (stored for efficient CPI signing)
    pub bump: u8,
}

impl RegistryConfig {
    /// Account discriminator (8) + group_mint (32) + authority (32) + total_agents (8) + bump (1)
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1;  // 81 bytes

    /// Check if registry is immutable (authority renounced)
    pub fn is_immutable(&self) -> bool {
        self.authority == Pubkey::default()
    }
}
```

### Instructions

#### 1. initialize

One-time setup to create the registry and TokenGroup.

```rust
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Initial registry authority (will be multisig in production)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Registry configuration PDA
    #[account(
        init,
        payer = authority,
        space = RegistryConfig::SIZE,
        seeds = [b"registry"],
        bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// TokenGroup mint - created by client before initialize()
    /// CHECK: Validated as Token-2022 mint with TokenGroup extension
    #[account(mut)]
    pub group_mint: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let registry = &mut ctx.accounts.registry_config;
    registry.authority = ctx.accounts.authority.key();
    registry.group_mint = ctx.accounts.group_mint.key();
    registry.total_agents = 0;
    registry.bump = ctx.bumps.registry_config;

    // CPI: Create Token-2022 mint with TokenGroup extension
    // CPI: Initialize TokenGroup with registry PDA as update_authority
    // max_size = 0 (unlimited)

    Ok(())
}
```

#### 2. register_agent

Canonical entry point for agent registration.

```rust
#[derive(Accounts)]
#[instruction(
    name: String,
    symbol: String,
    uri: String,
)]
pub struct RegisterAgent<'info> {
    /// Pays for account creation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Agent NFT owner (default: payer)
    /// CHECK: Can be any valid pubkey
    pub owner: UncheckedAccount<'info>,

    /// Registry configuration
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, RegistryConfig>,

    /// TokenGroup mint (for membership)
    /// CHECK: Validated against registry_config.group_mint
    #[account(
        address = registry_config.group_mint
    )]
    pub group_mint: UncheckedAccount<'info>,

    /// New agent NFT mint (randomly generated keypair)
    #[account(mut)]
    pub agent_mint: Signer<'info>,

    /// Owner's ATA for agent NFT
    /// CHECK: Initialized via CPI
    #[account(mut)]
    pub agent_token_account: UncheckedAccount<'info>,

    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn register_agent(
    ctx: Context<RegisterAgent>,
    name: String,
    symbol: String,
    uri: String,
    additional_metadata: Option<Vec<(String, String)>>,
    non_transferable: bool,
) -> Result<()> {
    // === Input Validation ===
    require!(name.len() <= MAX_NAME_LENGTH, SatiError::NameTooLong);
    require!(symbol.len() <= MAX_SYMBOL_LENGTH, SatiError::SymbolTooLong);
    require!(uri.len() <= MAX_URI_LENGTH, SatiError::UriTooLong);

    if let Some(ref metadata) = additional_metadata {
        require!(
            metadata.len() <= MAX_METADATA_ENTRIES,
            SatiError::TooManyMetadataEntries
        );
        for (key, value) in metadata {
            require!(key.len() <= MAX_METADATA_KEY_LENGTH, SatiError::MetadataKeyTooLong);
            require!(value.len() <= MAX_METADATA_VALUE_LENGTH, SatiError::MetadataValueTooLong);
        }
    }

    // ============================================================
    // THREE-PHASE CPI PATTERN (from cascade-splits best practices)
    // ============================================================
    //
    // Phase 1: Read state, capture values, DROP BORROW before CPIs
    // Phase 2: Execute all CPIs (no AccountLoader borrow held)
    // Phase 3: Write state back after CPIs succeed
    //
    // This prevents borrow checker issues when mixing account reads
    // with CPI calls that may touch the same accounts.
    // ============================================================

    // === PHASE 1: Read state and prepare CPI parameters ===
    let (group_mint, registry_bump, current_count) = {
        let registry = &ctx.accounts.registry_config;
        (registry.group_mint, registry.bump, registry.total_agents)
    };
    // Borrow is now dropped - safe to make CPIs

    // === PHASE 2: Execute all CPIs ===

    // 2a. Create Token-2022 mint with extensions
    // - Calculate space for: MetadataPointer, TokenMetadata,
    //   GroupMemberPointer, TokenGroupMember, NonTransferable (optional)
    // - Create account via System Program
    // - Initialize extensions via Token-2022 CPIs

    // 2b. Initialize TokenMetadata
    // - Set name, symbol, uri
    // - Set update_authority to owner
    // - Set additional_metadata key-value pairs

    // 2c. Initialize GroupMember (registry PDA signs)
    let registry_seeds = &[b"registry".as_ref(), &[registry_bump]];
    // invoke_signed for TokenGroupMember initialization
    // member_number auto-assigned by TokenGroup

    // 2d. Create owner's ATA and mint NFT
    // - Create ATA via Associated Token Program
    // - Mint exactly 1 token via Token-2022
    // - Renounce mint_authority to None (supply=1 forever)

    // === PHASE 3: Write state after CPIs succeed ===
    let registry = &mut ctx.accounts.registry_config;
    registry.total_agents = current_count
        .checked_add(1)
        .ok_or(SatiError::Overflow)?;

    // === Emit Event ===
    emit!(AgentRegistered {
        mint: ctx.accounts.agent_mint.key(),
        owner: ctx.accounts.owner.key(),
        member_number: registry.total_agents,
        name: name.clone(),
        uri: uri.clone(),
        non_transferable,
    });

    Ok(())
}
```

#### 3. update_registry_authority

Transfer or renounce registry authority.

```rust
#[derive(Accounts)]
pub struct UpdateRegistryAuthority<'info> {
    /// Current authority (must sign)
    pub authority: Signer<'info>,

    /// Registry configuration
    #[account(
        mut,
        seeds = [b"registry"],
        bump = registry_config.bump,
        has_one = authority @ SatiError::InvalidAuthority,
        constraint = !registry_config.is_immutable() @ SatiError::ImmutableAuthority
    )]
    pub registry_config: Account<'info, RegistryConfig>,
}

pub fn update_registry_authority(
    ctx: Context<UpdateRegistryAuthority>,
    new_authority: Option<Pubkey>,
) -> Result<()> {
    let registry = &mut ctx.accounts.registry_config;
    let old_authority = registry.authority;

    // None = renounce (set to default pubkey = immutable)
    registry.authority = new_authority.unwrap_or(Pubkey::default());

    emit!(RegistryAuthorityUpdated {
        old_authority,
        new_authority,
    });

    Ok(())
}
```

### Events

```rust
#[event]
pub struct AgentRegistered {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub member_number: u64,
    pub name: String,
    pub uri: String,
    pub non_transferable: bool,
}

#[event]
pub struct RegistryAuthorityUpdated {
    pub old_authority: Pubkey,
    pub new_authority: Option<Pubkey>,  // None = renounced
}
```

### Error Codes

```rust
#[error_code]
pub enum SatiError {
    // Note: AlreadyInitialized not needed - Anchor's `init` constraint
    // automatically prevents double initialization

    #[msg("Invalid authority")]
    InvalidAuthority,

    #[msg("Authority is immutable (renounced)")]
    ImmutableAuthority,

    #[msg("Name too long (max 32 bytes)")]
    NameTooLong,

    #[msg("Symbol too long (max 10 bytes)")]
    SymbolTooLong,

    #[msg("URI too long (max 200 bytes)")]
    UriTooLong,

    #[msg("Too many metadata entries (max 10)")]
    TooManyMetadataEntries,

    #[msg("Metadata key too long (max 32 bytes)")]
    MetadataKeyTooLong,

    #[msg("Metadata value too long (max 200 bytes)")]
    MetadataValueTooLong,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Failed to renounce mint authority - supply guarantee violated")]
    MintAuthorityNotRenounced,
}
```

### Agent Removal

There is no `remove_agent` instruction. To "remove" an agent:

1. **Burn the NFT** - Owner closes the token account and burns the mint
2. **TokenGroupMember remains** - Historical record preserved, `member_number` never reused
3. **SAS attestations remain** - Feedback/validation history preserved

This ensures audit trail integrity while allowing owners to exit.

### Cross-Program Invocation (CPI)

Other programs **can call `register_agent()`** via CPI:

```rust
// Example: Another program registering an agent via CPI
use sati_registry::cpi::accounts::RegisterAgent;
use sati_registry::cpi::register_agent;

let cpi_accounts = RegisterAgent {
    payer: ctx.accounts.payer.to_account_info(),
    owner: ctx.accounts.owner.to_account_info(),
    registry_config: ctx.accounts.registry_config.to_account_info(),
    group_mint: ctx.accounts.group_mint.to_account_info(),
    agent_mint: ctx.accounts.agent_mint.to_account_info(),
    agent_token_account: ctx.accounts.agent_token_account.to_account_info(),
    token_2022_program: ctx.accounts.token_2022_program.to_account_info(),
    associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
    system_program: ctx.accounts.system_program.to_account_info(),
};

let cpi_ctx = CpiContext::new(
    ctx.accounts.sati_program.to_account_info(),
    cpi_accounts,
);

register_agent(cpi_ctx, name, symbol, uri, additional_metadata, non_transferable)?;
```

### Fees

**SATI has no registration fees.** This is a public standard - charging fees would:
- Create barriers to adoption
- Conflict with the goal of universal agent identity
- Require fee management complexity

The only costs are Solana rent (~0.003 SOL per agent) which goes to the user's account, not SATI.

---

## Identity: Token-2022 NFT

### Why Not SAS for Identity?

| Aspect | SAS Attestation | Token-2022 NFT |
|--------|-----------------|----------------|
| Wallet display | Not shown | Phantom, Solflare, Backpack |
| Transfer | Close + recreate | Standard token transfer |
| Auto-incrementing ID | Manual | TokenGroupMember.member_number |
| Collections | None | TokenGroup |
| Browsability | Custom tooling | Explorers show NFTs |

### Token-2022 Extensions Used

```typescript
const EXTENSIONS = [
  ExtensionType.MetadataPointer,    // Points to metadata location
  ExtensionType.TokenMetadata,      // Stores name, symbol, uri, additionalMetadata
  ExtensionType.GroupMemberPointer, // Points to group membership
  ExtensionType.TokenGroupMember,   // Membership in SATI Registry
  // Optional:
  ExtensionType.NonTransferable,    // For soulbound agent identities
];
```

### Agent NFT Configuration

| Property | Value | Reason |
|----------|-------|--------|
| `decimals` | `0` | NFT (indivisible) |
| `supply` | `1` | Unique identity |
| `mint_authority` | `None` | Renounced atomically after minting |
| `freeze_authority` | `None` | No one can freeze agent NFTs |

**Critical**: The `register_agent` instruction atomically mints exactly 1 token and renounces mint authority to `None` within the same transaction. This guarantees supply=1 forever - verifiable on-chain.

### TokenMetadata Structure

```typescript
interface TokenMetadata {
  updateAuthority?: PublicKey;  // Agent owner (can update)
  mint: PublicKey;              // Agent NFT mint = agentId
  name: string;                 // Agent name
  symbol: string;               // "SATI" or agent type
  uri: string;                  // → ERC-8004 registration file
  additionalMetadata: [string, string][];  // Key-value pairs
}

// Example additionalMetadata (CAIP-10 format for wallets):
// ["agentWallet", "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv"]
//                         ^^ chain (mainnet genesis hash)   ^^ account pubkey
// ["did", "did:web:agent.example.com"]
// ["a2a", "https://agent.example/.well-known/agent-card.json"]
// ["mcp", "https://mcp.agent.example/"]
```

### TokenGroup Structure

```typescript
// SATI Registry TokenGroup
interface TokenGroup {
  updateAuthority: Pubkey;  // Registry PDA
  mint: Pubkey;             // SATI collection mint
  size: u64;                // Current number of agents
  maxSize: u64;             // Max agents (0 = unlimited)
}

// Per-agent membership
interface TokenGroupMember {
  mint: Pubkey;         // Agent NFT mint (= agentId)
  group: Pubkey;        // → SATI Registry group mint
  memberNumber: u64;    // Auto-incrementing (like ERC-721 tokenId)
}
```

### Metadata and Transfer Operations

Metadata updates and transfers use **direct Token-2022 calls** (not wrapped by registry):

```typescript
import { updateTokenMetadataField } from '@solana/spl-token-metadata';
import { transfer } from '@solana/spl-token';

// Update metadata - direct Token-2022 call
await updateTokenMetadataField(
  connection,
  payer,
  agentMint,
  updateAuthority,
  'uri',
  'ipfs://NewRegistrationFile'
);

// Transfer agent - direct Token-2022 transfer
await transfer(
  connection,
  payer,
  fromTokenAccount,
  toTokenAccount,
  owner,
  1,  // amount = 1 NFT
  [],
  undefined,
  TOKEN_2022_PROGRAM_ID
);
```

### Smart Account Compatibility

Token-2022 works natively with Squads smart accounts:

```typescript
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

// ATA for smart account owning agent NFT
const smartAccountAta = getAssociatedTokenAddressSync(
  agentNftMint,           // Token-2022 NFT mint
  smartAccountPda,        // Squads smart account as owner
  true,                   // allowOwnerOffCurve = true (required for PDAs)
  TOKEN_2022_PROGRAM_ID
);
```

No special work needed - smart accounts can:
- Own agent NFTs
- Transfer via Squads proposals
- Update metadata (with proposal approval)

---

## Reputation & Validation: SAS

### SAS Program

Solana Attestation Service (SAS) by Solana Foundation:

| Network | Program ID |
|---------|------------|
| Mainnet/Devnet | `22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG` |

- **Repository**: https://github.com/solana-foundation/solana-attestation-service
- **NPM**: https://www.npmjs.com/package/sas-lib

### SAS Schema Layout Types

The `layout` array uses numeric type identifiers from the Solana Attestation Service:

| Type ID | Type | Description |
|---------|------|-------------|
| 0 | U8 | Unsigned 8-bit integer (0-255) |
| 1 | U16 | Unsigned 16-bit integer (0-65535) |
| 2 | U32 | Unsigned 32-bit integer |
| 3 | U64 | Unsigned 64-bit integer |
| 8 | I64 | Signed 64-bit integer (for timestamps) |
| 12 | String | UTF-8 string with 4-byte length prefix |
| 13 | VecU8 | Byte array with 4-byte length prefix |

**Example**: `layout: [12, 0, 12, 13]` means:
- Field 1: String
- Field 2: U8
- Field 3: String
- Field 4: VecU8

### Attestation Nonce Computation

SAS attestation PDAs are derived using `["attestation", credential, schema, nonce]`.
The nonce must be unique per attestation to avoid PDA collisions.

**SATI Nonce Formulas** (using keccak256 hash → base58 encoded):

| Attestation Type | Nonce Formula |
|------------------|---------------|
| FeedbackAuth | `keccak256("feedbackAuth:" + agentMint + ":" + clientPubkey)` |
| Feedback | `keccak256("feedback:" + agentMint + ":" + clientPubkey + ":" + timestamp)` |
| FeedbackResponse | `keccak256("response:" + feedbackId + ":" + responderPubkey + ":" + index)` |
| ValidationRequest | `keccak256("validationReq:" + agentMint + ":" + validatorPubkey + ":" + userNonce)` |
| ValidationResponse | `keccak256("validationResp:" + requestId + ":" + responseIndex)` |

This ensures:
- **FeedbackAuth**: One per client per agent
- **Feedback**: Multiple allowed via timestamp
- **FeedbackResponse**: Multiple responders via index
- **ValidationRequest**: Multiple requests via userNonce
- **ValidationResponse**: Multiple responses via responseIndex

### Schema Definitions

#### 1. FeedbackAuth Schema

Replaces ERC-8004's off-chain signature with on-chain attestation.

```typescript
const FEEDBACK_AUTH_SCHEMA = {
  name: "SATIFeedbackAuth",
  version: 1,
  description: "Authorization for client to submit feedback",
  layout: [12, 1, 8],  // String, U16, I64
  fieldNames: [
    "agent_mint",        // Agent NFT mint address (base58 string)
    "index_limit",       // Maximum feedback index allowed (ERC-8004 indexLimit)
    "expiry",            // Unix timestamp (0 = use SAS expiry)
  ]
};

// Attestation configuration:
// - credential = agent NFT mint
// - subject = client pubkey (authorized reviewer)
// - issuer = agent owner
// - nonce = keccak256("feedbackAuth:" + agentMint + ":" + clientPubkey)
```

#### 2. Feedback Schema

```typescript
const FEEDBACK_SCHEMA = {
  name: "SATIFeedback",
  version: 1,
  description: "Client feedback for agent (ERC-8004 compatible)",
  layout: [12, 0, 12, 12, 12, 13, 12],  // String, U8, String, String, String, VecU8, String
  fieldNames: [
    "agent_mint",      // Agent NFT mint receiving feedback (base58 string)
    "score",           // 0-100 as U8 (matches ERC-8004 uint8)
    "tag1",            // Optional categorization (string)
    "tag2",            // Optional categorization (string)
    "fileuri",         // Off-chain feedback details (IPFS)
    "filehash",        // SHA-256 hash (32 bytes)
    "payment_proof",   // x402 transaction reference (optional)
  ]
};

// Attestation configuration:
// - credential = agent NFT mint
// - issuer = client (feedback giver)
// - nonce = keccak256("feedback:" + agentMint + ":" + clientPubkey + ":" + timestamp)
```

> **Score Type Rationale**: Score uses U8 (type 0) for type safety and efficient
> serialization. This matches ERC-8004's uint8 (0-255) range exactly.

#### 3. FeedbackResponse Schema

```typescript
const FEEDBACK_RESPONSE_SCHEMA = {
  name: "SATIFeedbackResponse",
  version: 1,
  description: "Response to feedback (ERC-8004 appendResponse)",
  layout: [12, 12, 13],  // String, String, VecU8
  fieldNames: [
    "feedback_id",      // Reference to feedback attestation pubkey (base58 string)
    "response_uri",     // Off-chain response details
    "response_hash",    // Content hash (32 bytes)
  ]
};

// Attestation configuration:
// - credential = agent NFT mint
// - issuer = responder (agent owner, auditor, etc.)
// - nonce = keccak256("response:" + feedbackId + ":" + responderPubkey + ":" + index)
```

#### 4. ValidationRequest Schema

```typescript
const VALIDATION_REQUEST_SCHEMA = {
  name: "SATIValidationRequest",
  version: 1,
  description: "Agent requests work validation",
  layout: [12, 12, 12, 13],  // String, String, String, VecU8
  fieldNames: [
    "agent_mint",      // Agent NFT mint requesting validation (base58 string)
    "method_id",       // Validation method (SATI extension, see note below)
    "request_uri",     // Off-chain validation data
    "request_hash",    // Content hash (32 bytes)
  ]
};

// Attestation configuration:
// - credential = agent NFT mint
// - subject = validator pubkey
// - issuer = agent owner
// - nonce = keccak256("validationReq:" + agentMint + ":" + validatorPubkey + ":" + userNonce)
```

> **method_id Extension**: The `method_id` field is a SATI-specific extension not present
> in ERC-8004. It explicitly identifies the validation approach ("tee", "zkml", "restake")
> since SATI validators may support multiple methods. ERC-8004 relies on the validator
> contract address to implicitly determine the method.

#### 5. ValidationResponse Schema

```typescript
const VALIDATION_RESPONSE_SCHEMA = {
  name: "SATIValidationResponse",
  version: 1,
  description: "Validator responds to request",
  layout: [12, 0, 12, 13, 12],  // String, U8, String, VecU8, String
  fieldNames: [
    "request_id",       // Reference to request attestation pubkey (base58 string)
    "response",         // 0-100 as U8 (0=fail, 100=pass)
    "response_uri",     // Off-chain evidence
    "response_hash",    // Content hash
    "tag",              // Optional categorization
  ]
};

// Attestation configuration:
// - credential = agent NFT mint (from request)
// - issuer = validator
// - nonce = keccak256("validationResp:" + requestId + ":" + responseIndex)
```

### Off-Chain Feedback File Structure

When using `fileuri` in feedback attestations, the referenced file should follow this structure:

```json
{
  "agentId": "sati:devnet:ABC123mintPubkey",
  "agentRegistry": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF",
  "clientAddress": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv",
  "createdAt": "2025-01-15T12:00:00Z",
  "score": 85,
  "tag1": "quality",
  "tag2": "speed",
  "skill": "code-review",
  "context": "Pull request review for authentication module",
  "paymentProof": {
    "protocol": "x402",
    "txSignature": "5K8Hg7...",
    "amount": "0.001",
    "token": "USDC"
  },
  "details": {
    "taskDescription": "Review PR #123 for security issues",
    "completionTime": 3600,
    "additionalNotes": "Found 2 critical issues, both resolved"
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `agentId` | Yes | SATI canonical identifier of the agent |
| `agentRegistry` | Yes | CAIP-2 address of the registry program |
| `clientAddress` | Yes | CAIP-10 address of the feedback giver |
| `createdAt` | Yes | ISO 8601 timestamp |
| `score` | Yes | Numeric score (0-100) |
| `tag1`, `tag2` | No | Categorization tags (should match on-chain) |
| `skill` | No | Specific skill being evaluated |
| `context` | No | Brief description of the interaction |
| `paymentProof` | No | x402 payment details if applicable |
| `details` | No | Extended feedback information |

The `filehash` on-chain field should contain the SHA-256 hash of this JSON file for integrity verification.

### Schema Versioning

If schemas need updates:

1. **Version in name** - `SATIFeedbackV1`, `SATIFeedbackV2`, etc.
2. **Old schemas remain valid** - Never delete, only add new versions
3. **SDK handles both** - Query multiple schema versions, present unified interface

### Immutable Claims & Certifications

For permanent, unmodifiable records (security audits, compliance certifications, credential attestations), **use SAS attestations rather than agent metadata**.

**Why not add immutable metadata to the registry?**

1. **Token-2022 TokenMetadata doesn't support per-field immutability** - would require additional PDA layer
2. **SAS attestations are already immutable by design** - attestation content cannot be modified after creation
3. **Simpler architecture** - no additional program complexity or audit surface

**Example: Security Certification**

```typescript
// Create immutable certification via SAS attestation
const CERTIFICATION_SCHEMA = {
  name: "SATICertification",
  version: 1,
  description: "Immutable certification for agent",
  layout: [12, 12, 12, 8],  // String, String, String, I64
  fieldNames: [
    "certifier",      // Certifying entity (e.g., "OtterSec")
    "cert_type",      // Certification type (e.g., "security-audit")
    "cert_uri",       // Link to full certificate/report
    "issued_at",      // Unix timestamp
  ]
};

// Attestation is permanent - cannot be modified or deleted by issuer
await sas.createAttestation({
  schema: certificationSchema,
  credential: agentMint,
  issuer: certifierPubkey,
  data: {
    certifier: "OtterSec",
    cert_type: "security-audit",
    cert_uri: "ipfs://QmAuditReport...",
    issued_at: Date.now() / 1000,
  }
});
```

**Use cases for SAS-based immutable claims:**
- Security audit completions
- Compliance certifications (SOC2, GDPR)
- Professional credentials
- Third-party verifications
- Historical performance records

**Use `additionalMetadata` for mutable agent properties:**
- Agent wallet address
- Endpoint URLs
- DID references
- Current capabilities

### Authority Separation

| Authority | Controls | Can Be Renounced? |
|-----------|----------|-------------------|
| **Registry authority** | `update_registry_authority()` only | Yes (immutable registry) |
| **SAS credential authority** | Create new schemas, update credential settings | No (keep for schema evolution) |

**Rationale:**
- Registry can become immutable while schemas continue to evolve
- Different security concerns: registration vs attestations
- Schema versioning requires ability to create new schemas
- Both should be multisig (Squads smart account)

---

## ERC-8004 Compatibility

### Registration File Format

SATI v2 uses the **exact same registration file format** as ERC-8004:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "myAgentName",
  "description": "Agent description",
  "image": "https://example.com/agent.png",
  "endpoints": [
    { "name": "A2A", "endpoint": "https://agent.example/agent-card.json", "version": "0.3.0" },
    { "name": "MCP", "endpoint": "https://mcp.agent.example/", "version": "2025-06-18" },
    { "name": "agentWallet", "endpoint": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv" }
  ],
  "registrations": [
    { "agentId": "sati:devnet:ABC123mint", "agentRegistry": "solana:devnet:satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF" },
    { "agentId": 22, "agentRegistry": "eip155:1:0x..." }
  ],
  "supportedTrust": ["reputation", "validation"]
}
```

### Compatibility Matrix

| ERC-8004 Feature | SATI v2 | Notes |
|------------------|---------|-------|
| Agent registration | ✅ | Registry program → Token-2022 NFT |
| `tokenId` (auto-incrementing) | ✅ | TokenGroupMember.member_number |
| `ownerOf(tokenId)` | ✅ | Token account holder |
| `transferFrom()` | ✅ | Direct Token-2022 transfer |
| `setApprovalForAll()` | ✅ | Token delegate |
| `tokenURI` / registration file | ✅ | TokenMetadata.uri |
| On-chain metadata | ✅ | TokenMetadata.additionalMetadata |
| `feedbackAuth` | ✅ | SAS attestation (better than off-chain sig) |
| `giveFeedback()` | ✅ | SAS Feedback attestation |
| `revokeFeedback()` | ✅ | Close attestation |
| `appendResponse()` | ✅ | SAS FeedbackResponse attestation |
| `getSummary()` | ✅ | Indexer (standard Solana pattern) |
| `readFeedback()` | ✅ | Fetch attestation |
| `validationRequest()` | ✅ | SAS ValidationRequest attestation |
| `validationResponse()` | ✅ | SAS ValidationResponse attestation |
| Wallet display | ✅ | Phantom, Solflare, Backpack |
| Cross-chain DID | ✅ | additionalMetadata["did"] |
| CAIP-2/CAIP-10 | ✅ | Chain-agnostic identifiers |

**Summary**: 100% functionally compatible. All ERC-8004 operations supported.

### CAIP and DID Support

SATI uses [Chain Agnostic Improvement Proposals](https://github.com/ChainAgnostic/CAIPs) for cross-chain interoperability:

#### CAIP-2: Blockchain ID

Chain identifiers follow CAIP-2 format: `namespace:reference`

| Chain | CAIP-2 Identifier |
|-------|-------------------|
| Solana Mainnet | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Solana Devnet | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` |
| Ethereum Mainnet | `eip155:1` |
| Base | `eip155:8453` |

#### CAIP-10: Account ID

Account identifiers follow CAIP-10 format: `chain_id:account_address`

```
// Solana account on mainnet:
solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv

// Ethereum account:
eip155:1:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7
```

#### DID Support

Agents can advertise DIDs via `additionalMetadata`:

```typescript
// Supported DID methods:
["did", "did:web:agent.example.com"]           // Web-based DID
["did", "did:pkh:solana:5eykt4...:7S3P4..."]   // PKH (blockchain account)
["did", "did:key:z6Mkf..."]                    // Key-based DID
```

#### SATI Canonical Identifier

SATI uses a custom format for agent identification following CAIP-2 patterns:

```
sati:<network>:<mint_address>

// Examples:
sati:mainnet:ABC123mintPubkey
sati:devnet:XYZ789mintPubkey
```

The registry program address is stored separately in the `agentRegistry` field using CAIP-2 format:

```json
{
  "agentId": "sati:devnet:ABC123mintPubkey",
  "agentRegistry": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF"
}
```

This separation allows:
- Compact agent identifiers (no redundant registry in every reference)
- Clear CAIP-2 compliance for registry addresses
- Flexibility for multi-registry scenarios

This format is used in:
- `registrations[]` array in registration files
- Cross-chain agent resolution
- Event indexing

---

## SDK Interface

```typescript
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

export class SATI {
  constructor(connection: Connection, options: { network: 'mainnet' | 'devnet' });

  // ============ REGISTRY ============

  /**
   * Register a new agent identity via registry program
   * Creates Token-2022 NFT with metadata + group membership atomically
   */
  async registerAgent(params: {
    name: string;
    symbol?: string;
    uri: string;
    additionalMetadata?: [string, string][];
    nonTransferable?: boolean;
    owner?: PublicKey;
  }): Promise<{ mint: PublicKey; memberNumber: number }>;

  // ============ IDENTITY (Direct Token-2022) ============

  async loadAgent(mint: PublicKey): Promise<AgentIdentity | null>;

  async updateAgentMetadata(
    mint: PublicKey,
    updates: {
      name?: string;
      uri?: string;
      additionalMetadata?: { key: string; value: string }[];
    }
  ): Promise<void>;

  async transferAgent(mint: PublicKey, newOwner: PublicKey): Promise<void>;

  async getAgentOwner(mint: PublicKey): Promise<PublicKey>;

  async listAgents(params?: { offset?: number; limit?: number }): Promise<AgentIdentity[]>;

  // ============ REPUTATION (SAS) ============

  async authorizeFeedback(params: {
    agentMint: PublicKey;
    client: PublicKey;
    maxSubmissions: number;
    expiresAt?: number;
  }): Promise<{ attestation: PublicKey }>;

  async revokeAuthorization(attestation: PublicKey): Promise<void>;

  async giveFeedback(params: {
    agentMint: PublicKey;
    score: number;
    tag1?: string;
    tag2?: string;
    fileUri?: string;
    fileHash?: Uint8Array;
    paymentProof?: string;
  }): Promise<{ attestation: PublicKey }>;

  async revokeFeedback(attestation: PublicKey): Promise<void>;

  async appendResponse(params: {
    feedbackAttestation: PublicKey;
    responseUri: string;
    responseHash?: Uint8Array;
  }): Promise<{ attestation: PublicKey }>;

  async readFeedback(attestation: PublicKey): Promise<Feedback | null>;

  // ============ VALIDATION (SAS) ============

  async requestValidation(params: {
    agentMint: PublicKey;
    validator: PublicKey;
    methodId: string;
    requestUri: string;
    requestHash?: Uint8Array;
  }): Promise<{ attestation: PublicKey }>;

  async respondToValidation(params: {
    requestAttestation: PublicKey;
    response: number;
    responseUri?: string;
    responseHash?: Uint8Array;
    tag?: string;
  }): Promise<{ attestation: PublicKey }>;

  async getValidationStatus(attestation: PublicKey): Promise<ValidationStatus | null>;
}
```

---

## Security Considerations

### Program Security

#### 1. Account Validation

All accounts are validated using Anchor constraints:

```rust
#[account(
    mut,
    seeds = [b"registry"],
    bump = registry_config.bump,
    has_one = authority @ SatiError::InvalidAuthority,
    constraint = !registry_config.is_immutable() @ SatiError::ImmutableAuthority
)]
pub registry_config: Account<'info, RegistryConfig>,
```

#### 2. Checked Arithmetic

All arithmetic operations use checked methods:

```rust
registry.total_agents = registry.total_agents
    .checked_add(1)
    .ok_or(SatiError::Overflow)?;
```

#### 3. PDA Security

- Registry PDA bump stored for efficient CPI signing
- Group mint is client-created, validated for TokenGroup extension
- Agent mints are random keypairs (not PDAs) for uniqueness

#### 4. CPI Security

All CPIs validate target program IDs:

```rust
pub token_2022_program: Program<'info, Token2022>,
pub associated_token_program: Program<'info, AssociatedToken>,
```

#### 5. Input Validation

All string inputs validated against maximum lengths:

```rust
require!(name.len() <= MAX_NAME_LENGTH, SatiError::NameTooLong);
require!(uri.len() <= MAX_URI_LENGTH, SatiError::UriTooLong);
```

### Token-2022 Security

- **Supply guarantee**: Mint authority renounced atomically after minting 1 token
- **No freeze authority**: Set to `None` at creation
- **Standard ownership**: Uses Token-2022's proven ownership model

### SAS Security

- **On-chain feedbackAuth**: Better than ERC-8004's off-chain signatures (can't be forged)
- **Expiry management**: Built into SAS primitive
- **Schema validation**: SAS validates data against schema

### Governance Security

- **Multisig authority**: Registry and SAS credential use Squads smart accounts
- **Immutability option**: Can renounce authority after stable
- **Separate authorities**: Registry vs SAS credential can be managed independently

### Pre-Deployment Checklist

- [ ] All accounts validated (signer, owner, writable, relationships)
- [ ] All arithmetic uses `checked_*` methods
- [ ] All PDAs use stored canonical bumps
- [ ] All CPIs validate target programs via `Program<'info, T>`
- [ ] All string inputs validated against max lengths
- [ ] No `unwrap()` or `expect()` in production code
- [ ] Unit tests cover all instructions
- [ ] Integration tests cover instruction interactions
- [ ] Edge cases tested (max values, overflow, empty strings)
- [ ] External security audit completed
- [ ] Upgrade authority secured with multisig

---

## Development Environment

### Rust Toolchain

Create `rust-toolchain.toml` in project root:

```toml
[toolchain]
channel = "1.89.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

### Anchor.toml

```toml
[toolchain]
package_manager = "pnpm"

[features]
resolution = true
skip-lint = false

[programs.localnet]
sati_registry = "satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF"

[programs.devnet]
sati_registry = "satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF"

[programs.mainnet]
sati_registry = "satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[test]
upgradeable = true

[scripts]
test = "pnpm vitest run tests/"
```

### Workspace Cargo.toml

```toml
[workspace]
members = ["programs/*"]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
```

### Program Cargo.toml

`programs/sati-registry/Cargo.toml`:

```toml
[package]
name = "sati-registry"
version = "0.1.0"
description = "Minimal agent identity registry for Solana - ERC-8004 compatible"
edition = "2021"
license = "Apache-2.0"

[lib]
crate-type = ["cdylib", "lib"]
name = "sati_registry"

[features]
default = []
cpi = ["no-entrypoint"]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]

[dependencies]
anchor-lang = "0.32.1"
anchor-spl = "0.32.1"
solana-security-txt = "1.1.1"

[dev-dependencies]
mollusk-svm = "0.5.1"
mollusk-svm-programs-token = "0.5.1"
solana-sdk = "2.2"
```

### Security.txt

Add to `lib.rs` for security contact information:

```rust
use solana_security_txt::security_txt;

security_txt! {
    name: "SATI Registry",
    project_url: "https://github.com/cascade-protocol/sati",
    contacts: "email:security@cascade.fyi",
    policy: "https://github.com/cascade-protocol/sati/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/cascade-protocol/sati"
}
```

### Key Versions Summary

| Component | Version |
|-----------|---------|
| Rust | 1.89.0 |
| Anchor | 0.32.1 |
| anchor-lang | 0.32.1 |
| anchor-spl | 0.32.1 |
| solana-sdk | 2.2 |
| spl-token-2022 | 8.0 |
| mollusk-svm | 0.5.1 |

---

## Testing

### Rust Unit Tests (mollusk-svm)

SATI uses **mollusk-svm** for fast, deterministic unit tests. Mollusk provides
lightweight SVM testing with built-in program support:

```rust
#[cfg(test)]
mod tests {
    use mollusk_svm::{Mollusk, result::Check};
    use solana_sdk::{
        pubkey::Pubkey,
        signature::{Keypair, Signer},
        program_error::ProgramError,
    };

    fn setup_mollusk() -> Mollusk {
        let mut mollusk = Mollusk::new(&PROGRAM_ID, "sati_registry");

        // Add Token-2022 program (bundled with mollusk-svm-programs-token)
        mollusk_svm_programs_token::token2022::add_program(&mut mollusk);

        mollusk
    }

    #[test]
    fn test_register_agent_name_too_long_fails() {
        let mollusk = setup_mollusk();

        // Setup accounts
        let payer = Pubkey::new_unique();
        let agent_mint = Keypair::new();

        // Build instruction with name > 32 bytes
        let long_name = "x".repeat(33);
        let instruction = build_register_agent(
            payer, payer, agent_mint.pubkey(),
            &long_name, "AGENT", "https://example.com/agent.json",
            None, false,
        );

        // Should fail with NameTooLong error
        let checks = vec![Check::err(ProgramError::Custom(
            error_code(SatiError::NameTooLong)
        ))];

        mollusk.process_and_validate_instruction(&instruction, &accounts, &checks);
    }

    #[test]
    fn test_register_agent_metadata_key_too_long_fails() {
        let mollusk = setup_mollusk();
        // Test metadata key > 32 bytes
        // Expect SatiError::MetadataKeyTooLong
    }

    #[test]
    fn test_register_agent_metadata_value_too_long_fails() {
        let mollusk = setup_mollusk();
        // Test metadata value > 200 bytes
        // Expect SatiError::MetadataValueTooLong
    }
}
```

### TypeScript E2E Tests (vitest)

Integration tests using the Anchor SDK:

```typescript
// tests/smoke.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { SatiRegistry } from '../target/types/sati_registry';

describe('SATI Registry', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SatiRegistry as Program<SatiRegistry>;

  it('initializes registry', async () => {
    // Test initialization...
  });

  it('registers an agent', async () => {
    // Test agent registration...
  });

  it('registers soulbound agent', async () => {
    // Test non-transferable agent...
  });
});
```

Run tests:
```bash
# Rust unit tests
cargo test

# TypeScript E2E tests
pnpm vitest run tests/
```

### Test Coverage Requirements

- [ ] `initialize` - Success case, already initialized error
- [ ] `register_agent` - Success, all validation errors (name/symbol/uri/metadata limits)
- [ ] `register_agent` - Non-transferable flag
- [ ] `register_agent` - Custom owner (different from payer)
- [ ] `update_registry_authority` - Transfer authority
- [ ] `update_registry_authority` - Renounce authority (immutable)
- [ ] `update_registry_authority` - Fails when already immutable
- [ ] Token-2022 integration - Metadata updates
- [ ] Token-2022 integration - NFT transfers

---

## Deployment

### Canonical Addresses

| Network | Program ID | Registry Config | Group Mint | Status |
|---------|------------|-----------------|------------|--------|
| Devnet | `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` | TBD | TBD | Not deployed |
| Mainnet | `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF` | TBD | TBD | Not deployed |

*Registry Config and Group Mint PDAs will be derived after deployment.*

### Off-Chain Storage

Registration files (referenced by `TokenMetadata.uri`) should be stored on **IPFS**:

```
ipfs://QmYourRegistrationFileHash
```

**Why IPFS:**
- Content-addressed (immutable once published)
- Decentralized (no single point of failure)
- ERC-8004 standard uses IPFS
- Free to pin via Pinata, web3.storage, etc.

### Implementation Order

1. ~~**Grind vanity keypair**~~ ✅ `satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`
2. **Implement sati-registry program** (~500 lines)
3. **Write comprehensive tests**
4. **Security audit**
5. **Deploy to devnet**
6. **Initialize registry** (create TokenGroup)
7. **Create SAS schemas** (5 schemas)
8. **Implement SDK**
9. **Test on devnet**
10. **Deploy to mainnet**
11. **Transfer authority to multisig**
12. **After stable: renounce authority** (immutable)

### One-Time Setup

```typescript
// 1. Initialize SATI Registry (creates TokenGroup)
const { registryConfig, groupMint } = await sati.initialize({
  authority: satiMultisig,  // Squads smart account
});

// 2. Create SAS credential for attestations
const sasCredential = await sas.createCredential({
  authority: satiMultisig,
  name: "SATI",
  signers: [satiMultisig],
});

// 3. Create SAS schemas (5 transactions)
const schemas = {
  feedbackAuth: await sas.createSchema({ ... }),
  feedback: await sas.createSchema({ ... }),
  feedbackResponse: await sas.createSchema({ ... }),
  validationRequest: await sas.createSchema({ ... }),
  validationResponse: await sas.createSchema({ ... }),
};

// 4. Publish addresses
console.log("SATI Program:", SATI_PROGRAM_ID);
console.log("Registry Config:", registryConfig);
console.log("Group Mint:", groupMint);
console.log("SAS Schemas:", schemas);
```

### Costs

#### Compute Units (Benchmarked)

| Operation | CUs | % of 1.4M Budget |
|-----------|-----|------------------|
| initialize | 10,918 | 0.8% |
| register_agent (minimal) | 58,342 | 4.2% |
| register_agent (3 metadata fields) | 82,877 | 5.9% |
| register_agent (max 10 fields) | 168,097 | 12.0% |
| register_agent (soulbound) | 79,255 | 5.7% |
| update_registry_authority | 3,516 | 0.3% |

*See [benchmarks/](./benchmarks/) for detailed measurements and methodology.*

#### Rent Costs (Estimated)

| Operation | Cost | Notes |
|-----------|------|-------|
| Initialize registry | ~0.005 SOL | One-time |
| Setup SAS schemas (5) | ~0.015 SOL | One-time |
| Register agent (minimal) | ~0.003 SOL | Mint + metadata + group member |
| Register agent (3 fields) | ~0.0035 SOL | +additional metadata |
| Register agent (10 fields) | ~0.005 SOL | Maximum metadata |
| Update metadata | ~0.00001 SOL | Transaction fee only |
| Transfer agent | ~0.00001 SOL | Transaction fee only |
| Authorize feedback | ~0.002 SOL | SAS attestation |
| Give feedback | ~0.002 SOL | SAS attestation |
| Close attestation | Rent refund | Get SOL back |

---

## Governance

### Authority Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Launch    │ ──▶ │   Stable    │ ──▶ │  Immutable  │
│  (Multisig) │     │  (Multisig) │     │  (No Auth)  │
└─────────────┘     └─────────────┘     └─────────────┘
     │                    │                    │
     │ - Fix bugs         │ - Monitor usage    │ - Fully trustless
     │ - Emergency fixes  │ - Community trust  │ - Cannot be changed
     │                    │ - Prepare renounce │ - Forever
```

### Program Upgrade Strategy

```
Development:  Upgradeable (BPF Upgradeable Loader)
               ↓
Stable:       Upgradeable (multisig controls upgrade authority)
               ↓
Mature:       Immutable (renounce upgrade authority)
```

**Upgrade authority** is separate from **registry authority**:
- Registry authority: Controls `update_registry_authority()` only
- Upgrade authority: Controls program code deployment

Both start as multisig, both can be renounced independently.

### Renounce Authority

```typescript
// After registry is stable and community trusts it
await sati.updateRegistryAuthority(null);  // Sets authority to Pubkey::default()
// Registry is now immutable forever
```

---

## Project Structure

```
sati/
├── Anchor.toml                  # Anchor configuration
├── Cargo.toml                   # Workspace configuration
├── rust-toolchain.toml          # Rust 1.89.0
│
├── programs/
│   └── sati-registry/           # Minimal Anchor program (~500 lines)
│       ├── Cargo.toml           # Program dependencies
│       └── src/
│           ├── lib.rs           # Entry point, #[program] macro, security_txt!
│           ├── state.rs         # RegistryConfig account
│           ├── errors.rs        # SatiError enum
│           ├── events.rs        # AgentRegistered, RegistryAuthorityUpdated
│           ├── constants.rs     # MAX_NAME_LENGTH, MAX_URI_LENGTH, etc.
│           └── instructions/
│               ├── mod.rs
│               ├── initialize.rs
│               ├── register_agent.rs
│               └── update_authority.rs
│
├── tests/                       # TypeScript E2E tests (vitest)
│   └── smoke.test.ts
│
├── sdk/                         # @cascade-splits/sati-sdk
│   ├── package.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── sati.ts              # Main SDK class
│   │   ├── registry.ts          # Registry program client
│   │   ├── identity.ts          # Token-2022 NFT operations
│   │   ├── reputation.ts        # SAS reputation operations
│   │   ├── validation.ts        # SAS validation operations
│   │   ├── schemas.ts           # SAS schema definitions
│   │   └── types.ts
│   └── tests/
│
├── examples/
│   ├── register-agent.ts
│   ├── give-feedback.ts
│   ├── request-validation.ts
│   └── smart-account-agent.ts   # Squads integration
│
├── docs/
│   └── SPECIFICATION.md         # This file
│
├── README.md
└── LICENSE
```

---

## What's NOT Included

| Feature | Reason |
|---------|--------|
| Mandates / AP2 lifecycle | No demand yet |
| User→Agent delegation | Can add via SAS later if needed |
| ZK Compression | Scale doesn't justify complexity |
| On-chain aggregation | Indexer is standard Solana pattern |
| Wrapped metadata/transfer | Direct Token-2022 calls are simpler |

These can be added as separate schemas/programs without breaking changes.

---

## Summary

SATI v2 achieves 100% ERC-8004 functional compatibility with:

- **SATI Registry Program** - Canonical address, atomic registration (~500 lines)
- **Token-2022** for identity (wallet support, transfers, collections)
- **SAS** for reputation and validation attestations
- **TypeScript SDK**
- **Indexer for aggregation queries**

| Component | Technology | Status |
|-----------|------------|--------|
| Registry | SATI Registry Program (`satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF`) | To implement |
| Identity | Token-2022 NFT + TokenMetadata + TokenGroup | Available |
| Reputation | SAS attestations | Available |
| Validation | SAS attestations | Available |
| Smart accounts | Native Token-2022 support | Available |

---

## References

- [ERC-8004: Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004)
- [Token-2022 Program](https://github.com/solana-program/token-2022)
- [Token Metadata Interface](https://github.com/solana-program/token-metadata)
- [Token Group Interface](https://github.com/solana-program/token-group)
- [Solana Attestation Service](https://github.com/solana-foundation/solana-attestation-service)
- [Squads Smart Account](https://github.com/Squads-Protocol/smart-account-program)
- [Anchor Framework](https://www.anchor-lang.com/docs)
