/**
 * Raydium CPMM pool — the standard memecoin venue.
 * Constant-product pool; indexed by Jupiter/Dexscreener/Birdeye automatically.
 */
import {
  CREATE_CPMM_POOL_PROGRAM,
  CREATE_CPMM_POOL_FEE_ACC,
  DEVNET_PROGRAM_ID,
  LOCK_CPMM_PROGRAM,
  LOCK_CPMM_AUTH,
  Raydium,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { confirm } from "../lib/common";
import { DexResult, LaunchCtx } from "./types";

export async function launchCpmm(ctx: LaunchCtx): Promise<DexResult> {
  const { connection, payer, cluster } = ctx;
  const isDev = cluster === "devnet";
  const programId = isDev
    ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
    : CREATE_CPMM_POOL_PROGRAM;
  const poolFeeAccount = isDev
    ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
    : CREATE_CPMM_POOL_FEE_ACC;

  const raydium = await Raydium.load({
    connection,
    owner: payer,
    cluster: isDev ? "devnet" : "mainnet",
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });

  const feeConfigs = await raydium.api.getCpmmConfigs();
  const feeConfig = feeConfigs.find((c: any) => c.index === 0) ?? feeConfigs[0];

  const mintBase = {
    address: ctx.mint.toBase58(),
    decimals: ctx.mintDecimals,
    programId: TOKEN_PROGRAM_ID.toBase58(),
  };
  const mintWsol = {
    address: NATIVE_MINT.toBase58(),
    decimals: 9,
    programId: TOKEN_PROGRAM_ID.toBase58(),
  };

  const txIds: string[] = [];
  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId,
    poolFeeAccount,
    mintA: mintBase,
    mintB: mintWsol,
    mintAAmount: ctx.liqTokenAmount,
    mintBAmount: ctx.liqSolLamports,
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true, feePayer: payer.publicKey },
    txVersion: TxVersion.V0,
  });

  const { txId } = await execute({ sendAndConfirm: true });
  txIds.push(txId);
  const poolId = extInfo.address.poolId;
  console.log(`  CPMM pool created: ${poolId.toBase58()} (tx ${txId})`);

  let lpAction = "kept in wallet";
  if (ctx.lpMode !== "keep") {
    const lpMint: PublicKey = extInfo.address.lpMint;
    const lpAta = await getAssociatedTokenAddress(lpMint, payer.publicKey);
    const lpAcc = await getAccount(connection, lpAta);

    if (ctx.lpMode === "burn") {
      const tx = new Transaction().add(
        createBurnCheckedInstruction(
          lpAta,
          lpMint,
          payer.publicKey,
          lpAcc.amount,
          9,
          [],
          TOKEN_PROGRAM_ID
        )
      );
      const sig = await connection.sendTransaction(tx, [payer]);
      await confirm(connection, sig);
      txIds.push(sig);
      lpAction = `burned ${lpAcc.amount.toString()} LP tokens`;
      console.log(`  LP burned: ${sig}`);
    } else if (ctx.lpMode === "lock") {
      const poolInfo = {
        id: poolId.toBase58(),
        programId: programId.toBase58(),
        lpMint: { address: lpMint.toBase58() },
        mintA: { address: mintBase.address },
        mintB: { address: mintWsol.address },
      } as any;
      const { execute: execLock, extInfo: lockExt } = await raydium.cpmm.lockLp({
        programId: isDev ? DEVNET_PROGRAM_ID.LOCK_CPMM_PROGRAM : LOCK_CPMM_PROGRAM,
        authProgram: isDev ? DEVNET_PROGRAM_ID.LOCK_CPMM_AUTH : LOCK_CPMM_AUTH,
        poolInfo,
        lpAmount: new BN(lpAcc.amount.toString()),
        withMetadata: true,
        txVersion: TxVersion.V0,
      });
      const { txId: lockTx } = await execLock({ sendAndConfirm: true });
      txIds.push(lockTx);
      lpAction = `locked via Raydium CpLock (nft ${lockExt?.nftMint?.toBase58?.() ?? "?"})`;
      console.log(`  LP locked: ${lockTx}`);
    }
  }

  return { dex: "raydium-cpmm", poolId: poolId.toBase58(), txIds, lpAction };
}
