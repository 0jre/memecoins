/**
 * Shared helpers: env, keypair loading, connections, tx confirm.
 */
import {
  Commitment,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  clusterApiUrl,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export const env = (k: string, d?: string): string => process.env[k] ?? (d as string);
export const envNum = (k: string, d: number): number =>
  process.env[k] ? Number(process.env[k]) : d;

export function clusterRpc(): { rpc: string; cluster: "devnet" | "mainnet" } {
  const c = (env("CLUSTER", "devnet") || "devnet").toLowerCase();
  const rpc = env("RPC_URL");
  if (rpc) return { rpc, cluster: c.includes("main") ? "mainnet" : "devnet" };
  if (c === "mainnet" || c === "mainnet-beta") {
    return { rpc: clusterApiUrl("mainnet-beta"), cluster: "mainnet" };
  }
  return { rpc: clusterApiUrl("devnet"), cluster: "devnet" };
}

export function loadPayer(): Keypair {
  const p = env("PAYER", path.join(os.homedir(), ".config", "solana", "id.json"));
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}

export async function sendTx(
  connection: Connection,
  payer: Keypair,
  ixs: TransactionInstruction[],
  extraSigners: Keypair[] = []
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(connection, tx, [payer, ...extraSigners], {
    commitment: "confirmed",
  });
}

export async function confirm(
  connection: Connection,
  sig: string,
  commitment: Commitment = "confirmed"
) {
  const bh = await connection.getLatestBlockhash(commitment);
  await connection.confirmTransaction({ signature: sig, ...bh }, commitment);
}

export function pubkey(s: string): PublicKey {
  return new PublicKey(s);
}
