use anchor_lang::prelude::*;

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
    pub new_authority: Option<Pubkey>,
}
