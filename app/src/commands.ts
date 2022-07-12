import { Firestore } from "@firebase/firestore";
import { TwitterApi } from "twitter-api-v2";
import Wallet from "./wallet";

export const parse = async (
  tweetId: string,
  userId: string,
  inReplyToUserId: string | undefined,
  instruction: string,
  wallet: Wallet,
  twitterClient: TwitterApi,
  db: Firestore
) => {
  const tokens = instruction.split(" ");
  if (tokens[0] != "@deadprimatesbot") throw new Error("Invalid Command");
  if (tokens[1] == "INITIALIZE") {
    if (tokens.length == 2) {
      await createNewAccount(wallet, tweetId, userId, twitterClient, db).catch(
        (err) => {
          throw err;
        }
      );
    } else {
      throw new Error("Invalid Command");
    }
  } else if (tokens[1] == "BET") {
    if (tokens.length != 3) {
      throw new Error("Invalid Commmand");
    }
    const amount = parseInt(tokens[2], 10);
    if (amount === NaN || amount <= 0) {
      throw Error("Invalid Amount");
    }
    await createBet(wallet, tweetId, userId, amount, twitterClient).catch(
      (err) => {
        throw err;
      }
    );
  } else if (tokens[1] == "ACCEPT") {
    if (tokens.length != 3) {
      throw Error("Invalid Command");
    }
    const gameIdentifier = tokens[2];
    await acceptBet(
      wallet,
      tweetId,
      userId,
      inReplyToUserId!,
      gameIdentifier,
      twitterClient,
      db
    ).catch((err) => {
      throw err;
    });
  }
};

const createBet = async (
  wallet: Wallet,
  tweetId: string,
  userid: string,
  amount: number,
  client: TwitterApi
) => {
  /*
  const [txHash, gameIdentifier] = await wallet
    .initializeBet(userid, amount)
    .catch((err) => {
      throw err;
    });
  // send the link to explorer
  const link = `https://explorer.solana.com/tx/${txHash}?cluster=devnet`;
  await client.v2.reply(`${link} ${gameIdentifier}`, tweetId);
  */
  const gameIdentifier = "00000000000000000000000000000000";
  client.v2.reply(`New Bet Created with id: ${gameIdentifier}`, tweetId);
};

const acceptBet = async (
  wallet: Wallet,
  tweetId: string,
  userId: string,
  initializerId: string,
  gameIdentifier: string,
  twitterClient: TwitterApi,
  db: Firestore
) => {
  /*
  const txHash1 = await wallet.joinBet(userId, gameIdentifier).catch((err) => {
    throw err;
  });
  const txHash2 = await wallet
    .winner(gameIdentifier, userId, initializerId, db)
    .catch((err) => {
      throw err;
    });

  await wallet.logout(userId).catch((err) => {
    throw err;
  });
  // send both the links on explorer
  const link1 = `https://explorer.solana.com/tx/${txHash1}?cluster=devnet`;
  const link2 = `https://explorer.solana.com/tx/${txHash2}?cluster=devnet`;
  await twitterClient.v2.reply(`${link1} ${link2}`, tweetId);
  */

  twitterClient.v2.reply(`Bet id: ${gameIdentifier} Accepted`, tweetId);
};

const createNewAccount = async (
  wallet: Wallet,
  tweetId: string,
  userId: string,
  twitterClient: TwitterApi,
  db: Firestore
) => {
  /*
  const { publicKey, mnemonic } = await wallet
    .createAccount(userId, db)
    .catch((err) => {
      throw err;
    });

  await twitterClient.v1.sendDm({ recipient_id: userId, text: mnemonic });
  */
  const publicKey = "00000000000000000000000000000000";
  twitterClient.v2.reply(`New User: ${publicKey}`, tweetId);
};
