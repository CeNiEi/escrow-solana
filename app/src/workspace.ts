import { clusterApiUrl } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { Idl, Program, web3 } from "@project-serum/anchor";
import idl from "./idl/escrow.json";
import { PublicKey } from "@solana/web3.js";

type Workspace = {
  connection: Connection;
  program: Program<Idl>;
  mint: web3.PublicKey;
};
let workspace: Workspace;

export const useWorkspace = () => workspace;

export const initWorkspace = () => {
  const cluster = clusterApiUrl("devnet");
  const connection = new Connection(cluster, "max");
  const program = new Program(
    idl as any as Idl,
    new PublicKey(idl.metadata.address),
    { connection: connection }
  );
  const mint = web3.PublicKey.default;

  workspace = {
    connection,
    program,
    mint,
  };
};