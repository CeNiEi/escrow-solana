use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use uuid::Uuid;
use borsh::{BorshSerialize, BorshDeserialize};

declare_id!("J9mANdmdHKN8xANP1LTdpRhDxPYcWWgn7N2FiEU8A3Vr");

#[error_code]
pub enum EscrowError {
    InvalidIdentifier, 
    InvalidStage,
    InsufficientBalance
}

#[derive(BorshSerialize, BorshDeserialize, Clone, PartialEq)]
pub enum EscrowStage {
    Initialized, 
    Deposited, 
}

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, amount: u64, identifier: String) -> Result<()> {
        require!(Uuid::try_parse(&identifier).is_ok(), EscrowError::InvalidIdentifier);

        let state = &mut ctx.accounts.transaction_state;

        state.bet_amount = amount;
        state.identifier = identifier.clone();
        state.stage = EscrowStage::Initialized;

        state.state_bump = *ctx.bumps.get("transaction_state").unwrap();
        state.escrow_bump = *ctx.bumps.get("escrow_wallet").unwrap();

        let state_bump_bytes = state.state_bump.to_le_bytes();
        let inner = vec![
            b"transaction-state".as_ref(),
            identifier.as_bytes(),
            state_bump_bytes.as_ref(),
        ];

        let outer = vec![inner.as_slice()];

        token::transfer(ctx.accounts.to_transfer_ctx().with_signer(&outer), amount)?;

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, identifier: String) -> Result<()> {
        require!(Uuid::try_parse(&identifier).is_ok(), EscrowError::InvalidIdentifier);
        let state = &mut ctx.accounts.transaction_state;

        require!(state.stage == EscrowStage::Initialized, EscrowError::InvalidStage);

        state.stage = EscrowStage::Deposited;

        let state_bump_bytes = state.state_bump.to_le_bytes();
        let inner = vec![
            b"transaction-state".as_ref(),
            identifier.as_bytes().as_ref(),
            state_bump_bytes.as_ref(),
        ];
        let outer = vec![inner.as_slice()];

        token::transfer(
            ctx.accounts.to_transfer_ctx().with_signer(&outer),
            ctx.accounts.transaction_state.bet_amount,
        )?;
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>, identifier: String) -> Result<()> {
        require!(Uuid::try_parse(&identifier).is_ok(), EscrowError::InvalidIdentifier);
        let state = &mut ctx.accounts.transaction_state;

        require!(state.stage == EscrowStage::Initialized, EscrowError::InvalidStage);

        let state_bump_bytes = state.state_bump.to_le_bytes();
        let inner = vec![
            b"transaction-state".as_ref(),
            identifier.as_bytes().as_ref(),
            state_bump_bytes.as_ref(),
        ];
        let outer = vec![inner.as_slice()];

        token::transfer(
            ctx.accounts.to_transfer_ctx().with_signer(&outer),
            ctx.accounts.transaction_state.bet_amount,
        )?;
        anchor_spl::token::close_account(ctx.accounts.to_close_ctx().with_signer(&outer))?;

        Ok(())
    }

    pub fn outcome(ctx: Context<Outcome>, identifier: String, _winner: Pubkey) -> Result<()> {
        require!(Uuid::try_parse(&identifier).is_ok(), EscrowError::InvalidIdentifier);

        let state = &mut ctx.accounts.transaction_state;
        require!(state.stage == EscrowStage::Deposited, EscrowError::InvalidStage);

        let state_bump_bytes = state.state_bump.to_le_bytes();
        let inner = vec![
            b"transaction-state".as_ref(),
            identifier.as_bytes().as_ref(),
            state_bump_bytes.as_ref(),
        ];
        let outer = vec![inner.as_slice()];

        token::transfer(
            ctx.accounts.to_transfer_ctx().with_signer(&outer),
            2 * ctx.accounts.transaction_state.bet_amount,
        )?;
        anchor_spl::token::close_account(ctx.accounts.to_close_ctx().with_signer(&outer))?;

        Ok(())
    }
}

#[account]
pub struct TransactionState {
    pub identifier: String,
    pub stage: EscrowStage,
    pub bet_amount: u64,
    pub state_bump: u8,
    pub escrow_bump: u8,
}

impl TransactionState {
    pub const LEN: usize = 4 + 32 + 1 + 8 + 1 + 1;
}

#[derive(Accounts)]
#[instruction(amount: u64, identifier: String)]
pub struct Initialize<'info> {
    #[account(
        init, 
        space = 8 + TransactionState::LEN, 
        payer = initializer, 
        seeds = [
            b"transaction-state".as_ref(), 
            identifier.as_bytes().as_ref()
        ], 
        bump
    )]
    transaction_state: Account<'info, TransactionState>,

    #[account(
        init, 
        payer = initializer, 
        seeds = [
            b"escrow-wallet".as_ref(), 
            identifier.as_bytes().as_ref()
        ], 
        bump, 
        token::mint = mint, 
        token::authority = transaction_state
    )]
    escrow_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    initializer: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = mint, 
        associated_token::authority = initializer,
        constraint = initializer_token_account.amount >= amount
        @ EscrowError::InsufficientBalance
    )]
    initializer_token_account: Account<'info, TokenAccount>,
    mint: Account<'info, Mint>,

    system_program: Program<'info, System>,
    token_program: Program<'info, Token>,
    rent: Sysvar<'info, Rent>,
}

impl<'info> Initialize<'info> {
    pub fn to_transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.initializer_token_account.to_account_info(),
            to: self.escrow_wallet.to_account_info(),
            authority: self.initializer.to_account_info(),
        };

        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

#[derive(Accounts)]
#[instruction(identifier: String)]
pub struct Deposit<'info> {
    #[account(
        mut, 
        seeds = [
            b"transaction-state".as_ref(), 
            identifier.as_bytes().as_ref()
        ], 
        bump = transaction_state.state_bump
    )]
    transaction_state: Account<'info, TransactionState>,

    #[account(
        mut, 
        seeds = [
            b"escrow-wallet".as_ref(), 
            identifier.as_bytes().as_ref()
        ],
        bump = transaction_state.escrow_bump
    )]
    escrow_wallet: Account<'info, TokenAccount>,

    #[account(mut)]
    joiner: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = mint, 
        associated_token::authority = joiner,
        constraint = joiner_token_account.amount >= transaction_state.bet_amount
        @ EscrowError::InsufficientBalance
    )]
    joiner_token_account: Account<'info, TokenAccount>,
    mint: Account<'info, Mint>,
    token_program: Program<'info, Token>,
}

impl<'info> Deposit<'info> {
    pub fn to_transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.joiner_token_account.to_account_info(),
            to: self.escrow_wallet.to_account_info(),
            authority: self.joiner.to_account_info(),
        };

        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

#[derive(Accounts)]
#[instruction(identifier: String)]
pub struct Cancel<'info> {
    #[account(
        mut, 
        seeds = [
            b"transaction-state".as_ref(), 
            identifier.as_bytes().as_ref() 
        ], 
        bump = transaction_state.state_bump, 
        close = initializer
    )]
    transaction_state: Account<'info, TransactionState>,

    #[account(
        mut, 
        seeds = [
            b"escrow-wallet".as_ref(), 
            identifier.as_bytes().as_ref() 
        ],
        bump = transaction_state.escrow_bump
    )]
    escrow_wallet: Account<'info, TokenAccount>,

    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    initializer: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = mint, 
        associated_token::authority = initializer,
    )]
    initializer_token_account: Account<'info, TokenAccount>,

    mint: Account<'info, Mint>,
    token_program: Program<'info, Token>,
}

impl<'info> Cancel<'info> {
    pub fn to_transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.escrow_wallet.to_account_info(),
            to: self.initializer_token_account.to_account_info(),
            authority: self.transaction_state.to_account_info(),
        };

        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }

    pub fn to_close_ctx(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let close_escrow_account_instruction = anchor_spl::token::CloseAccount {
            account: self.escrow_wallet.to_account_info(),
            destination: self.initializer.to_account_info(),
            authority: self.transaction_state.to_account_info(),
        };

        CpiContext::new(
            self.token_program.to_account_info(),
            close_escrow_account_instruction,
        )
    }
}

#[derive(Accounts)]
#[instruction(identifier: String, winner: Pubkey)]
pub struct Outcome<'info> {
    #[account(
        mut, 
        seeds = [
            b"transaction-state".as_ref(), 
            identifier.as_bytes().as_ref()
        ], 
        bump = transaction_state.state_bump, 
        close = initializer
    )]
    transaction_state: Account<'info, TransactionState>,

    #[account(
        mut, 
        seeds = [
            b"escrow-wallet".as_ref(), 
            identifier.as_bytes().as_ref()
        ],
        bump = transaction_state.escrow_bump
    )]
    escrow_wallet: Account<'info, TokenAccount>,

    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    initializer: AccountInfo<'info>,

    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    joiner: AccountInfo<'info>,

    #[account(
        mut,
        constraint = winner_token_account.owner == winner,
        constraint = winner_token_account.mint == mint.key()
    )]
    winner_token_account: Account<'info, TokenAccount>,

    mint: Account<'info, Mint>,
    token_program: Program<'info, Token>,
}

impl<'info> Outcome<'info> {
    pub fn to_transfer_ctx(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.escrow_wallet.to_account_info(),
            to: self.winner_token_account.to_account_info(),
            authority: self.transaction_state.to_account_info(),
        };

        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }

    pub fn to_close_ctx(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let close_escrow_account_instruction = anchor_spl::token::CloseAccount {
            account: self.escrow_wallet.to_account_info(),
            destination: self.initializer.to_account_info(),
            authority: self.transaction_state.to_account_info(),
        };

        CpiContext::new(
            self.token_program.to_account_info(),
            close_escrow_account_instruction,
        )
    }
}
