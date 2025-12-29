/**
 * Instruction building utilities for Light Protocol.
 *
 * Uses Solana Kit patterns:
 * - AccountMeta with Address and AccountRole
 * - Pure data objects instead of classes where possible
 */

import { type Address, type AccountMeta, AccountRole, getProgramDerivedAddress } from "@solana/kit";
import {
  LIGHT_SYSTEM_PROGRAM,
  REGISTERED_PROGRAM_PDA,
  NOOP_PROGRAM,
  ACCOUNT_COMPRESSION_PROGRAM,
} from "../constants.js";

// =============================================================================
// System Account Configuration
// =============================================================================

/**
 * Configuration for Light System Program account metas.
 */
export interface SystemAccountMetaConfig {
  /** The program making the CPI call */
  selfProgram: Address;
  /** Optional CPI context account */
  cpiContext?: Address;
  /** Optional SOL compression recipient */
  solCompressionRecipient?: Address;
  /** Optional SOL pool PDA */
  solPoolPda?: Address;
}

/**
 * Create a basic system account config.
 */
export function createSystemAccountConfig(selfProgram: Address): SystemAccountMetaConfig {
  return { selfProgram };
}

/**
 * Create a system account config with CPI context.
 */
export function createSystemAccountConfigWithCpi(selfProgram: Address, cpiContext: Address): SystemAccountMetaConfig {
  return { selfProgram, cpiContext };
}

// =============================================================================
// Account Metas Helpers
// =============================================================================

/**
 * Derive the CPI signer PDA for a program.
 */
export async function getCpiSignerPda(selfProgram: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: selfProgram,
    seeds: [new TextEncoder().encode("cpi_authority")],
  });
  return pda;
}

/**
 * Derive the account compression authority PDA.
 */
export async function getAccountCompressionAuthority(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: LIGHT_SYSTEM_PROGRAM,
    seeds: [new TextEncoder().encode("cpi_authority")],
  });
  return pda;
}

/**
 * Get the system program address.
 */
export function getSystemProgram(): Address {
  return "11111111111111111111111111111111" as Address;
}

/**
 * Build Light System account metas (V1 layout).
 */
export async function getLightSystemAccountMetas(config: SystemAccountMetaConfig): Promise<AccountMeta[]> {
  const cpiSigner = await getCpiSignerPda(config.selfProgram);
  const compressionAuthority = await getAccountCompressionAuthority();

  const metas: AccountMeta[] = [
    { address: LIGHT_SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: cpiSigner, role: AccountRole.READONLY },
    { address: REGISTERED_PROGRAM_PDA, role: AccountRole.READONLY },
    { address: NOOP_PROGRAM, role: AccountRole.READONLY },
    { address: compressionAuthority, role: AccountRole.READONLY },
    { address: ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
    { address: config.selfProgram, role: AccountRole.READONLY },
  ];

  if (config.solPoolPda) {
    metas.push({ address: config.solPoolPda, role: AccountRole.WRITABLE });
  }
  if (config.solCompressionRecipient) {
    metas.push({
      address: config.solCompressionRecipient,
      role: AccountRole.WRITABLE,
    });
  }
  metas.push({ address: getSystemProgram(), role: AccountRole.READONLY });
  if (config.cpiContext) {
    metas.push({ address: config.cpiContext, role: AccountRole.WRITABLE });
  }

  return metas;
}

/**
 * Build Light System account metas (V2 layout - no noop program).
 */
export async function getLightSystemAccountMetasV2(config: SystemAccountMetaConfig): Promise<AccountMeta[]> {
  const cpiSigner = await getCpiSignerPda(config.selfProgram);
  const compressionAuthority = await getAccountCompressionAuthority();

  const metas: AccountMeta[] = [
    { address: LIGHT_SYSTEM_PROGRAM, role: AccountRole.READONLY },
    { address: cpiSigner, role: AccountRole.READONLY },
    { address: REGISTERED_PROGRAM_PDA, role: AccountRole.READONLY },
    { address: compressionAuthority, role: AccountRole.READONLY },
    { address: ACCOUNT_COMPRESSION_PROGRAM, role: AccountRole.READONLY },
    { address: getSystemProgram(), role: AccountRole.READONLY },
  ];

  if (config.solPoolPda) {
    metas.push({ address: config.solPoolPda, role: AccountRole.WRITABLE });
  }
  if (config.solCompressionRecipient) {
    metas.push({
      address: config.solCompressionRecipient,
      role: AccountRole.WRITABLE,
    });
  }
  if (config.cpiContext) {
    metas.push({ address: config.cpiContext, role: AccountRole.WRITABLE });
  }

  return metas;
}

// =============================================================================
// PackedAccounts Class
// =============================================================================

/**
 * Helper class for building remaining accounts for Light Protocol instructions.
 *
 * Manages three categories of accounts:
 * 1. Pre-accounts: Signers and other accounts that come first
 * 2. System accounts: Light System Program static accounts
 * 3. Packed accounts: Dynamic accounts indexed by pubkey
 */
export class PackedAccounts {
  private preAccounts: AccountMeta[] = [];
  private systemAccounts: AccountMeta[] = [];
  private nextIndex: number = 0;
  private accountMap: Map<string, [number, AccountMeta]> = new Map();

  /**
   * Create a new PackedAccounts with system accounts (V1 layout).
   */
  static async newWithSystemAccounts(config: SystemAccountMetaConfig): Promise<PackedAccounts> {
    const instance = new PackedAccounts();
    await instance.addSystemAccounts(config);
    return instance;
  }

  /**
   * Create a new PackedAccounts with system accounts (V2 layout).
   */
  static async newWithSystemAccountsV2(config: SystemAccountMetaConfig): Promise<PackedAccounts> {
    const instance = new PackedAccounts();
    await instance.addSystemAccountsV2(config);
    return instance;
  }

  /**
   * Add a signer to pre-accounts (readonly).
   */
  addPreAccountsSigner(pubkey: Address): void {
    this.preAccounts.push({
      address: pubkey,
      role: AccountRole.READONLY_SIGNER,
    });
  }

  /**
   * Add a writable signer to pre-accounts.
   */
  addPreAccountsSignerMut(pubkey: Address): void {
    this.preAccounts.push({
      address: pubkey,
      role: AccountRole.WRITABLE_SIGNER,
    });
  }

  /**
   * Add an account meta to pre-accounts.
   */
  addPreAccountsMeta(accountMeta: AccountMeta): void {
    this.preAccounts.push(accountMeta);
  }

  /**
   * Add system accounts (V1 layout).
   */
  async addSystemAccounts(config: SystemAccountMetaConfig): Promise<void> {
    const metas = await getLightSystemAccountMetas(config);
    this.systemAccounts.push(...metas);
  }

  /**
   * Add system accounts (V2 layout).
   */
  async addSystemAccountsV2(config: SystemAccountMetaConfig): Promise<void> {
    const metas = await getLightSystemAccountMetasV2(config);
    this.systemAccounts.push(...metas);
  }

  /**
   * Insert or get index for a writable account.
   */
  insertOrGet(pubkey: Address): number {
    return this.insertOrGetConfig(pubkey, false, true);
  }

  /**
   * Insert or get index for a readonly account.
   */
  insertOrGetReadOnly(pubkey: Address): number {
    return this.insertOrGetConfig(pubkey, false, false);
  }

  /**
   * Insert or get index with full configuration.
   */
  insertOrGetConfig(pubkey: Address, isSigner: boolean, isWritable: boolean): number {
    const key = pubkey as string;
    const existing = this.accountMap.get(key);
    if (existing) {
      return existing[0];
    }

    const index = this.nextIndex++;
    let role: AccountRole;
    if (isSigner && isWritable) {
      role = AccountRole.WRITABLE_SIGNER;
    } else if (isSigner) {
      role = AccountRole.READONLY_SIGNER;
    } else if (isWritable) {
      role = AccountRole.WRITABLE;
    } else {
      role = AccountRole.READONLY;
    }

    const meta: AccountMeta = { address: pubkey, role };
    this.accountMap.set(key, [index, meta]);
    return index;
  }

  /**
   * Get packed accounts sorted by insertion order.
   */
  private getPackedAccountMetas(): AccountMeta[] {
    const entries = Array.from(this.accountMap.entries());
    entries.sort((a, b) => a[1][0] - b[1][0]);
    return entries.map(([, [, meta]]) => meta);
  }

  /**
   * Get offsets for system and packed accounts.
   */
  private getOffsets(): [number, number] {
    const systemStart = this.preAccounts.length;
    const packedStart = systemStart + this.systemAccounts.length;
    return [systemStart, packedStart];
  }

  /**
   * Build final remaining accounts array with offsets.
   */
  toAccountMetas(): {
    remainingAccounts: AccountMeta[];
    systemStart: number;
    packedStart: number;
  } {
    const packed = this.getPackedAccountMetas();
    const [systemStart, packedStart] = this.getOffsets();

    return {
      remainingAccounts: [...this.preAccounts, ...this.systemAccounts, ...packed],
      systemStart,
      packedStart,
    };
  }
}
