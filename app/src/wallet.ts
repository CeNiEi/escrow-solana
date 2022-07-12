import Keyv from "keyv";
import { generateMnemonic, mnemonicToSeed } from "bip39";
import nacl from "tweetnacl";
import { Firestore, setDoc, doc, getDoc } from "@firebase/firestore";
import { web3 } from "@project-serum/anchor";
import {
  createAta,
  fetchAta,
  findPda,
  initializeBetRpc,
  joinBetRpc,
  winnerRpc,
} from "./solana";
import { v4 } from "uuid";
import { useWorkspace } from "./workspace";

export default class Wallet {
  privateKeys;
  publicKeys;

  constructor() {
    this.privateKeys = new Keyv();
    this.publicKeys = new Keyv();
  }

  async getKeypair(id: string) {
    const [secretKey, publicKey] = await Promise.all([
      this.privateKeys.get(id),
      this.publicKeys.get(id),
    ]);

    return { secretKey, publicKey };
  }

  async setKeypair(id: string, privateKey: Uint8Array, publicKey: string) {
    await Promise.all([
      this.privateKeys.set(id, privateKey),
      this.publicKeys.set(id, publicKey),
    ]);
  }

  async login(id: string, privateKey: Uint8Array, publicKey: string) {
    await Promise.all([this.setKeypair(id, privateKey, publicKey)]);
  }

  async logout(id: string) {
    Promise.all([this.privateKeys.delete(id), this.publicKeys.delete(id)]);
  }

  async isLoggedIn(id: string) {
    !!(await this.privateKeys.get(id));
  }

  async createAccountFromMnemonic(mnemonic: string) {
    const seed = await mnemonicToSeed(mnemonic);
    const keyPair = nacl.sign.keyPair.fromSeed(seed.subarray(0, 32));
    const wallet = web3.Keypair.fromSecretKey(keyPair.secretKey);

    return {
      secretKey: wallet.secretKey,
      publicKey: wallet.publicKey.toString(),
    };
  }

  async createAccount(id: string, db: Firestore) {
    const mnemonic = generateMnemonic();
    const { publicKey, secretKey } = await this.createAccountFromMnemonic(
      mnemonic
    );

    await this.login(id, secretKey, publicKey);

    const docRef = doc(db, "userPublicKey", id);
    await setDoc(docRef, {
      publicKey: publicKey,
    });

    return {
      secretKey,
      publicKey,
      mnemonic,
    };
  }

  async initializeBet(id: string, amount: number) {
    const userKeypair = await this.getKeypair(id);
    const { mint } = useWorkspace();
    try {
      const gameIdentifier = v4().replace(/-/g, "");
      const initializerTokenAccount = await createAta(mint, userKeypair);
      const [transactionState, escrowWallet] = await findPda(gameIdentifier);
      const txHash = await initializeBetRpc({
        gameIdentifier,
        initializerPrivateKey: userKeypair.secretKey,
        initializerTokenAccount,
        amountInSol: amount,
        transactionState,
        escrowWallet,
      });
      return [txHash, gameIdentifier];
    } catch (err) {
      throw err;
    }
  }

  async joinBet(id: string, gameIdentifier: string) {
    const userKeypair = await this.getKeypair(id);
    const { mint } = useWorkspace();

    try {
      const joinerTokenAccount = await createAta(mint, userKeypair);
      const [transactionState, escrowWallet] = await findPda(gameIdentifier);
      const txHash = await joinBetRpc({
        gameIdentifier,
        joinerPrivateKey: userKeypair.secretKey,
        joinerTokenAccount,
        transactionState,
        escrowWallet,
      });
      return txHash;
    } catch (err) {
      throw err;
    }
  }

  async winner(
    gameIdentifier: string,
    joinerId: string,
    initializerId: string,
    db: Firestore
  ) {
    const { mint } = useWorkspace();
    const joinerDocRef = doc(db, "userPublicKey", joinerId);
    const initializerDocRef = doc(db, "userPublicKey", initializerId);

    const joinerPublicKey = await (await getDoc(joinerDocRef)).data()!
      .publicKey;
    const initializerPublicKey = await (await getDoc(initializerDocRef)).data()!
      .publicKey;

    try {
      let winnerPublicKey: web3.PublicKey;
      let winnerTokenAccount: web3.PublicKey;
      if (Math.random() < 0.5) {
        winnerPublicKey = initializerPublicKey;
        winnerTokenAccount = await fetchAta(mint, initializerPublicKey);
      } else {
        winnerPublicKey = joinerPublicKey;
        winnerTokenAccount = await fetchAta(mint, joinerPublicKey);
      }

      const [transactionState, escrowWallet] = await findPda(gameIdentifier);

      const txHash = await winnerRpc({
        gameIdentifier,
        winnerPublicKey,
        initializerPublicKey,
        winnerTokenAccount,
        transactionState,
        escrowWallet,
      });

      return txHash;
    } catch (err) {
      throw err;
    }
  }
}
