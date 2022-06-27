import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";

import { Program } from "@project-serum/anchor";
import { Escrow } from "../target/types/escrow";

import assert from "assert";

interface State {
  mint: anchor.web3.PublicKey;
  mintAuthority: anchor.web3.Keypair;

  initializer: anchor.web3.Keypair;
  initializerTokenAccount: anchor.web3.PublicKey;

  joiner: anchor.web3.Keypair;
  joinerTokenAccount: anchor.web3.PublicKey;

  transactionState: anchor.web3.PublicKey;
  escrowWallet: anchor.web3.PublicKey;
}

const createUser = async (
  provider: anchor.AnchorProvider
): Promise<anchor.web3.Keypair> => {
  const user = new anchor.web3.Keypair();

  const amount = 10;
  let txHash = await provider.connection.requestAirdrop(
    user.publicKey,
    amount * anchor.web3.LAMPORTS_PER_SOL
  );

  const latestBlockhash = await provider.connection.getLatestBlockhash();

  await provider.connection.confirmTransaction({
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    signature: txHash,
  });

  return user;
};

const createTokenAccount = async (
  provider: anchor.AnchorProvider,
  user: anchor.web3.Keypair,
  mint: anchor.web3.PublicKey,
  mintAuthority: anchor.web3.Keypair
): Promise<anchor.web3.PublicKey> => {
  const userTokenAccount = await spl.getAssociatedTokenAddress(
    mint,
    user.publicKey
  );

  const tx = new anchor.web3.Transaction();
  const amount = 100;

  tx.add(
    spl.createAssociatedTokenAccountInstruction(
      user.publicKey,
      userTokenAccount,
      user.publicKey,
      mint
    )
  );

  tx.add(
    spl.createMintToInstruction(
      mint,
      userTokenAccount,
      mintAuthority.publicKey,
      amount * 10 ** 9
    )
  );

  await provider.sendAndConfirm(tx, [user, mintAuthority]);

  return userTokenAccount;
};

const readTokenAccount = async (
  provider: anchor.AnchorProvider,
  accountPublicKey: anchor.web3.PublicKey
): Promise<string> => {
  const tokenInfoLol = await provider.connection.getAccountInfo(
    accountPublicKey
  );

  const accountInfo: spl.RawAccount = spl.AccountLayout.decode(
    tokenInfoLol.data
  );

  const amount = accountInfo.amount;
  return amount.toString();
};

const pdaSetup = async (
  program: anchor.Program<Escrow>,
  identifier: string
) => {
  const [transactionState] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      anchor.utils.bytes.utf8.encode("transaction-state"),
      anchor.utils.bytes.utf8.encode(identifier),
    ],
    program.programId
  );

  const [escrowWallet] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      anchor.utils.bytes.utf8.encode("escrow-wallet"),
      anchor.utils.bytes.utf8.encode(identifier),
    ],
    program.programId
  );

  return {
    transactionState: transactionState,
    escrowWallet: escrowWallet,
  };
};

const setup = async (provider: anchor.AnchorProvider) => {
  const initializer = await createUser(provider);
  const joiner = await createUser(provider);

  const mintAuthority = await createUser(provider);
  const mint = await spl.createMint(
    provider.connection,
    mintAuthority,
    mintAuthority.publicKey,
    mintAuthority.publicKey,
    9
  );

  const initializerTokenAccount = await createTokenAccount(
    provider,
    initializer,
    mint,
    mintAuthority
  );
  const joinerTokenAccount = await createTokenAccount(
    provider,
    joiner,
    mint,
    mintAuthority
  );

  return {
    mint: mint,
    mintAuthority: mintAuthority,

    initializer: initializer,
    initializerTokenAccount: initializerTokenAccount,

    joiner: joiner,
    joinerTokenAccount: joinerTokenAccount,
  };
};

describe("escrow", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;

  let state1: State;
  let state2: State;

  it("can setup all the prereqs", async () => {
    let common = await setup(provider);

    state1 = {
      ...common,
      ...(await pdaSetup(program, "unique")),
    };
    state2 = {
      ...common,
      ...(await pdaSetup(program, "unique2")),
    };
  });

  it("can initialize the escrow", async () => {
    const preTxInitializerBalance = await readTokenAccount(
      provider,
      state1.initializerTokenAccount
    );
    assert.equal(preTxInitializerBalance, 100 * 10 ** 9);

    const txHash = await program.methods
      .initialize(new anchor.BN(5 * 10 ** 9), "unique")
      .accounts({
        transactionState: state1.transactionState,
        escrowWallet: state1.escrowWallet,
        initializer: state1.initializer.publicKey,
        initializerTokenAccount: state1.initializerTokenAccount,
        mint: state1.mint,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([state1.initializer])
      .rpc();

    const postTxInitializerBalance = await readTokenAccount(
      provider,
      state1.initializerTokenAccount
    );
    assert.equal(postTxInitializerBalance, 95 * 10 ** 9);

    const postTxEscrowBalance = await readTokenAccount(
      provider,
      state1.escrowWallet
    );
    assert.equal(postTxEscrowBalance, 5 * 10 ** 9);

    console.log(
      `Initialized a new Safe Pay instance with signature: ${txHash}`
    );
  });

  it("can deposit funds by joiner", async () => {
    const preTxJoinerBalance = await readTokenAccount(
      provider,
      state1.joinerTokenAccount
    );
    assert.equal(preTxJoinerBalance, 100 * 10 ** 9);

    const txHash = await program.methods
      .deposit("unique")
      .accounts({
        transactionState: state1.transactionState,
        escrowWallet: state1.escrowWallet,
        joiner: state1.joiner.publicKey,
        joinerTokenAccount: state1.joinerTokenAccount,
        mint: state1.mint,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .signers([state1.joiner])
      .rpc();

    const postTxJoinerBalance = await readTokenAccount(
      provider,
      state1.joinerTokenAccount
    );
    assert.equal(postTxJoinerBalance, 95 * 10 ** 9);

    const postTxEscrowBalance = await readTokenAccount(
      provider,
      state1.escrowWallet
    );
    assert.equal(postTxEscrowBalance, 10 * 10 ** 9);

    console.log(`Deposited funds by the joiner with signature: ${txHash}`);
  });

  it("can initialize multiple escrows", async () => {
    const preTxInitializerBalance = await readTokenAccount(
      provider,
      state2.initializerTokenAccount
    );
    assert.equal(preTxInitializerBalance, 95 * 10 ** 9);

    const txHash = await program.methods
      .initialize(new anchor.BN(5 * 10 ** 9), "unique2")
      .accounts({
        transactionState: state2.transactionState,
        escrowWallet: state2.escrowWallet,
        initializer: state2.initializer.publicKey,
        initializerTokenAccount: state2.initializerTokenAccount,
        mint: state2.mint,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([state2.initializer])
      .rpc();

    const postTxInitializerBalance = await readTokenAccount(
      provider,
      state2.initializerTokenAccount
    );
    assert.equal(postTxInitializerBalance, 90 * 10 ** 9);

    const postTxEscrowBalance = await readTokenAccount(
      provider,
      state2.escrowWallet
    );
    assert.equal(postTxEscrowBalance, 5 * 10 ** 9);

    console.log(
      `Initialized a new Safe Pay instance with signature: ${txHash}`
    );
  });

  it("can transfer funds to the winner", async () => {
    let winner: anchor.web3.Keypair;
    let winnerTokenAccount: anchor.web3.PublicKey;

    if (Math.random() < 0.5) {
      winner = state1.initializer;
      winnerTokenAccount = state1.initializerTokenAccount;
    } else {
      winner = state1.joiner;
      winnerTokenAccount = state1.joinerTokenAccount;
    }

    const txHash = await program.methods
      .outcome("unique", winner.publicKey)
      .accounts({
        transactionState: state1.transactionState,
        escrowWallet: state1.escrowWallet,
        initializer: state1.initializer.publicKey,
        joiner: state1.joiner.publicKey,
        winnerTokenAccount: winnerTokenAccount,
        mint: state1.mint,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .rpc();

    try {
      await readTokenAccount(provider, state1.escrowWallet);
      return assert.fail("Account should be closed");
    } catch (e) {
      assert.equal(
        e.message,
        "Cannot read properties of null (reading 'data')"
      );
    }

    try {
      await readTokenAccount(provider, state1.transactionState);
      return assert.fail("Account should be deleted");
    } catch (e) {
      assert.equal(
        e.message,
        "Cannot read properties of null (reading 'data')"
      );
    }

    assert.ok(txHash);
    console.log(
      `Successfully transfered the funds to the winner with signature: ${txHash}`
    );
  });

  it("can deposit funds by joiner in the 2nd game", async () => {
    const txHash = await program.methods
      .deposit("unique2")
      .accounts({
        transactionState: state2.transactionState,
        escrowWallet: state2.escrowWallet,
        joiner: state2.joiner.publicKey,
        joinerTokenAccount: state2.joinerTokenAccount,
        mint: state2.mint,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .signers([state2.joiner])
      .rpc();

    const postTxEscrowBalance = await readTokenAccount(
      provider,
      state2.escrowWallet
    );
    assert.equal(postTxEscrowBalance, 10 * 10 ** 9);

    console.log(`Deposited funds by the joiner with signature: ${txHash}`);
  });

  it("can transfer funds to the winner of the 2nd game", async () => {
    let winner: anchor.web3.Keypair;
    let winnerTokenAccount: anchor.web3.PublicKey;

    if (Math.random() < 0.5) {
      winner = state2.initializer;
      winnerTokenAccount = state2.initializerTokenAccount;
    } else {
      winner = state2.joiner;
      winnerTokenAccount = state2.joinerTokenAccount;
    }

    const txHash = await program.methods
      .outcome("unique2", winner.publicKey)
      .accounts({
        transactionState: state2.transactionState,
        escrowWallet: state2.escrowWallet,
        initializer: state2.initializer.publicKey,
        joiner: state2.joiner.publicKey,
        winnerTokenAccount: winnerTokenAccount,
        mint: state2.mint,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .rpc();

    try {
      await readTokenAccount(provider, state2.escrowWallet);
      return assert.fail("Account should be closed");
    } catch (e) {
      assert.equal(
        e.message,
        "Cannot read properties of null (reading 'data')"
      );
    }

    try {
      await readTokenAccount(provider, state2.transactionState);
      return assert.fail("Account should be deleted");
    } catch (e) {
      assert.equal(
        e.message,
        "Cannot read properties of null (reading 'data')"
      );
    }

    assert.ok(txHash);
    console.log(
      `Successfully transfered the funds to the winner with signature: ${txHash}`
    );
  });
});
