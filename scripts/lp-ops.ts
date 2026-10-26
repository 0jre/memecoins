/**
 * Post-launch LP ops for CPMM pools — machine-readable runner for the MCP.
 *
 * Usage:  npx ts-node --transpile-only scripts/lp-ops.ts <burn|lock> <poolId>
 * Output: one line "RESULT {json}" on success or failure.
 * Env: CLUSTER, RPC_URL, PAYER (same as launch-dex.ts).
 */
import {
  DEVNET_PROGRAM_ID,
  LOCK_CPMM_PROGRAM,
  LOCK_CPMM_AUTH,
  Raydium,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { clusterRpc, loadPayer } from "./lib/common";

const { rpc, cluster } = clusterRpc();
const connection = new Connection(rpc, "confirmed");
const payer = loadPayer();

async function raydium(): Promise<Raydium> {
  return Raydium.load({
    connection,
    owner: payer,
    cluster: cluster === "devnet" ? "devnet" : "mainnet",
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
}

async function burnCpmmLp(poolId: string) {
  const r = await raydium();
  const info = await r.cpmm.getRpcPoolInfo(poolId);
  const lpMint = new PublicKey(info.mintLp);
  const lpAta = await getAssociatedTokenAddress(lpMint, payer.publicKey);
  const acc = await getAccount(connection, lpAta);
  if (acc.amount === 0n) throw new Error("no LP tokens in wallet");
  const tx = new Transaction().add(
    createBurnCheckedInstruction(
      lpAta,
      lpMint,
      payer.publicKey,
      acc.amount,
      info.lpDecimals ?? 9,
      [],
      TOKEN_PROGRAM_ID
    )
  );
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, "confirmed");
  return { op: "burn", sig, burned: acc.amount.toString() };
}

async function lockCpmmLp(poolId: string) {
  const r = await raydium();
  const isDev = cluster === "devnet";
  const info = await r.cpmm.getRpcPoolInfo(poolId);
  const lpMint = new PublicKey(info.mintLp);
  const lpAta = await getAssociatedTokenAddress(lpMint, payer.publicKey);
  const acc = await getAccount(connection, lpAta);
  if (acc.amount === 0n) throw new Error("no LP tokens in wallet");

  const poolInfo = {
    id: poolId,
    programId:
      info.programId?.toBase58?.() ??
      (isDev ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58() : undefined),
    lpMint: { address: lpMint.toBase58() },
    mintA: { address: info.mintA.toBase58() },
    mintB: { address: info.mintB.toBase58() },
  } as any;

  const { execute, extInfo } = await r.cpmm.lockLp({
    programId: isDev ? DEVNET_PROGRAM_ID.LOCK_CPMM_PROGRAM : LOCK_CPMM_PROGRAM,
    authProgram: isDev ? DEVNET_PROGRAM_ID.LOCK_CPMM_AUTH : LOCK_CPMM_AUTH,
    poolInfo,
    lpAmount: new BN(acc.amount.toString()),
    withMetadata: true,
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  return { op: "lock", txId, nft: extInfo?.nftMint?.toBase58?.() };
}

async function main() {
  const [op, poolId] = process.argv.slice(2);
  if (!poolId || (op !== "burn" && op !== "lock"))
    throw new Error("usage: lp-ops.ts <burn|lock> <poolId>");
  const result = op === "burn" ? await burnCpmmLp(poolId) : await lockCpmmLp(poolId);
  console.log("RESULT " + JSON.stringify(result));
}

main().catch((e) => {
  console.log("RESULT " + JSON.stringify({ error: String(e?.message ?? e) }));
  process.exit(1);
});
