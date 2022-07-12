import { ETwitterStreamEvent, TwitterApi } from "twitter-api-v2";
import { parse } from "./commands";
import "dotenv/config";
import Wallet from "./wallet";
import { initWorkspace } from "./workspace";
import { initializeApp } from "firebase/app";
import { getFirestore } from "@firebase/firestore";

(async () => {
  const twitterClient = new TwitterApi({
    appKey: process.env.TWITTER_APP_KEY!,
    appSecret: process.env.TWITTER_APP_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
  });

  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY!,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.FIREBASE_PROJECT_ID!,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET!,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID!,
    appId: process.env.FIREBASE_APP_ID!,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID!,
  };

  const firebaseClient = initializeApp(firebaseConfig);
  const db = getFirestore(firebaseClient);

  initWorkspace();

  const wallet = new Wallet();

  const appLogin = await twitterClient.appLogin();
  const stream = await appLogin.v2.searchStream({
    expansions: ["author_id", "in_reply_to_user_id"],
  });

  stream.on(ETwitterStreamEvent.Data, (eventData) => {
    const { data } = eventData;
    const {
      id: tweetId,
      author_id: authorId,
      text: instruction,
      in_reply_to_user_id: inReplyToUserId,
    } = data;
    parse(
      tweetId,
      authorId!,
      inReplyToUserId,
      instruction,
      wallet,
      twitterClient,
      db
    ).catch((err) => {
      console.log(instruction);
      console.log(err);
    });
  });
  //await appLogin.v2.updateStreamRules({
  //  add: [
  //    {
  //      value: "ACCEPT is:reply",
  //    },
  //  ],
  //});
  //console.log(await appLogin.v2.streamRules());
})();
