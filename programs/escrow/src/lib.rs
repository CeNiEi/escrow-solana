use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, Token, Transfer};

declare_id!("J9mANdmdHKN8xANP1LTdpRhDxPYcWWgn7N2FiEU8A3Vr");

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, amount: u64, identifier: String) -> Result<()> {
        let state = &mut ctx.accounts.transaction_state; 

        state.initializer = ctx.accounts.initializer.key().clone();
        state.initializer_token_account = ctx.accounts.initializer_token_account.key().clone();
        state.escrow_wallet = ctx.accounts.escrow_wallet.key().clone();

        state.bet_amount = amount;

        state.state_bump = *ctx.bumps.get("transaction_state").unwrap();
        state.escrow_bump = *ctx.bumps.get("escrow_wallet").unwrap();

        let cpi_accounts = Transfer {
            from: ctx.accounts.initializer_token_account.to_account_info(),
            to: ctx.accounts.escrow_wallet.to_account_info(),
            authority: ctx.accounts.initializer.to_account_info()
        };

        let state_bump_bytes = ctx.accounts.transaction_state.state_bump.to_le_bytes();
        let inner = vec![
            b"transaction-state".as_ref(),
            identifier.as_bytes().as_ref(),
            state_bump_bytes.as_ref(),
        ];
        let outer = vec![inner.as_slice()];

        let cpi_context = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, &outer);

        token::transfer(cpi_context, amount)?;

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, identifier: String) -> Result<()> {
        let state = &mut ctx.accounts.transaction_state; 

        state.joiner = ctx.accounts.joiner.key().clone();
        state.joiner_token_account = ctx.accounts.joiner_token_account.key().clone();
      
        let cpi_accounts = Transfer {
            from: ctx.accounts.joiner_token_account.to_account_info(),
            to: ctx.accounts.escrow_wallet.to_account_info(),
            authority: ctx.accounts.joiner.to_account_info()
        };

        let state_bump_bytes = ctx.accounts.transaction_state.state_bump.to_le_bytes();
        let inner = vec![
            b"transaction-state".as_ref(),
            identifier.as_bytes().as_ref(),
            state_bump_bytes.as_ref(),
        ];
        let outer = vec![inner.as_slice()];

        let cpi_context = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, &outer);

        token::transfer(cpi_context, ctx.accounts.transaction_state.bet_amount)?;
        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {

        Ok(())
    }

    pub fn outcome(ctx: Context<Outcome>, identifier: String, _winner: Pubkey) -> Result<()> {
        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_wallet.to_account_info(),
            to: ctx.accounts.winner_token_account.to_account_info(),
            authority: ctx.accounts.transaction_state.to_account_info()
        };

        let state_bump_bytes = ctx.accounts.transaction_state.state_bump.to_le_bytes();
        let inner = vec![
            b"transaction-state".as_ref(),
            identifier.as_ref(),
            state_bump_bytes.as_ref(),
        ];
        let outer = vec![inner.as_slice()];

        let cpi_context = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, &outer);
        
        token::transfer(cpi_context, 2 * ctx.accounts.transaction_state.bet_amount)?;

        let close_escrow_account_instruction = anchor_spl::token::CloseAccount {
            account: ctx.accounts.escrow_wallet.to_account_info(),
            destination: ctx.accounts.initializer.to_account_info(),
            authority: ctx.accounts.transaction_state.to_account_info(),
        };
    
        let close_escrow_account_cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            close_escrow_account_instruction,
            &outer,
        );
    
        anchor_spl::token::close_account(close_escrow_account_cpi_ctx)?;
        Ok(())
    }
}

#[account]
pub struct TransactionState {
    pub initializer: Pubkey,
    pub initializer_token_account: Pubkey,
    pub joiner: Pubkey, 
    pub joiner_token_account: Pubkey,
    pub escrow_wallet: Pubkey,
    pub bet_amount: u64,
    pub state_bump: u8,
    pub escrow_bump: u8
}

impl TransactionState {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 8 + 1 + 1;
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
    )]
    initializer_token_account: Account<'info, TokenAccount>,
    mint: Account<'info, Mint>,

    system_program: Program<'info, System>, 
    token_program: Program<'info, Token>,
    rent: Sysvar<'info, Rent>
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
            identifier.as_ref()
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
    )]
    joiner_token_account: Account<'info, TokenAccount>,
    mint: Account<'info, Mint>,
    token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Cancel {
}

#[derive(Accounts)]
#[instruction(identifier: String, winner: Pubkey)]
pub struct Outcome<'info> {
   #[account(
        mut, 
        seeds = [
            b"transaction-state".as_ref(), 
            identifier.as_ref() 
        ], 
        bump = transaction_state.state_bump, 
        close = initializer
    )] 
    transaction_state: Account<'info, TransactionState>, 

    #[account(
        mut, 
        seeds = [
            b"escrow-wallet".as_ref(), 
            identifier.as_ref()
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