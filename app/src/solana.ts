import { web3, BN, utils } from "@project-serum/anchor";
import {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useWorkspace } from "./workspace";

export const fetchAta = async (mint: web3.PublicKey, key: web3.PublicKey) => {
  const ata = await getAssociatedTokenAddress(mint, key);
  return ata;
};
export const createAta = async (mint: web3.PublicKey, keyPair: web3.Signer) => {
  const { connection } = useWorkspace();
  const ata = await getOrCreateAssociatedTokenAccount(
    connection,
    keyPair,
    mint,
    keyPair.publicKey
  );
  return ata.address;
};

export const findPda = async (gameIdentifier: string) => {
  const { program } = useWorkspace();
  const [transactionState] = await web3.PublicKey.findProgramAddress(
    [
      utils.bytes.utf8.encode("transaction-state"),
      utils.bytes.utf8.encode(gameIdentifier),
    ],
    program.programId
  );

  const [escrowWallet] = await web3.PublicKey.findProgramAddress(
    [
      utils.bytes.utf8.encode("escrow-wallet"),
      utils.bytes.utf8.encode(gameIdentifier),
    ],
    program.programId
  );

  return [transactionState, escrowWallet];
};

type InitializeBetRpcParams = {
  gameIdentifier: string;
  initializerPrivateKey: Uint8Array;
  initializerTokenAccount: web3.PublicKey;
  amountInSol: number;
  transactionState: web3.PublicKey;
  escrowWallet: web3.PublicKey;
};

export const initializeBetRpc = async (payload: InitializeBetRpcParams) => {
  const { mint, program } = useWorkspace();
  const initializerKeypair = web3.Keypair.fromSecretKey(
    payload.initializerPrivateKey
  );

  try {
    const txHash = await program.methods
      .initialize(new BN(payload.amountInSol), payload.gameIdentifier)
      .accounts({
        transactionState: payload.transactionState,
        escrowWallet: payload.escrowWallet,
        initializer: initializerKeypair.publicKey,
        initializerTokenAccount: payload.initializerTokenAccount,
        mint,
        systemProgram: web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([initializerKeypair])
      .rpc();
    return txHash;
  } catch (err) {
    console.log(err);
    throw new Error("Transaction Failed");
  }
};

type JoinBetRpcParams = {
  gameIdentifier: string;
  joinerPrivateKey: Uint8Array;
  joinerTokenAccount: web3.PublicKey;
  transactionState: web3.PublicKey;
  escrowWallet: web3.PublicKey;
};

export const joinBetRpc = async (payload: JoinBetRpcParams) => {
  const { program, mint } = useWorkspace();
  const joinerKeypair = web3.Keypair.fromSecretKey(payload.joinerPrivateKey);

  try {
    const txHash = await program.methods
      .deposit(payload.gameIdentifier)
      .accounts({
        transactionState: payload.transactionState,
        escrowWallet: payload.escrowWallet,
        joiner: joinerKeypair.publicKey,
        joinerTokenAccount: payload.joinerTokenAccount,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([joinerKeypair])
      .rpc();
    return txHash;
  } catch (err) {
    console.log(err);
    throw new Error("Transaction Failed");
  }
};

type WinnerRpcParams = {
  gameIdentifier: string;
  winnerPublicKey: web3.PublicKey;
  initializerPublicKey: web3.PublicKey;
  winnerTokenAccount: web3.PublicKey;
  transactionState: web3.PublicKey;
  escrowWallet: web3.PublicKey;
};

export const winnerRpc = async (payload: WinnerRpcParams) => {
  const { program, mint } = useWorkspace();

  try {
    const txHash = await program.methods
      .outcome(payload.gameIdentifier, payload.winnerPublicKey)
      .accounts({
        transactionState: payload.transactionState,
        escrowWallet: payload.escrowWallet,
        initializer: payload.initializerPublicKey,
        winnerTokenAccount: payload.winnerTokenAccount,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return txHash;
  } catch (err) {
    console.log(err);
    throw new Error("Transaction Failed");
  }
};