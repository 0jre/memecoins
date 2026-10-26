/**
 * Raydium CLMM pool — concentrated liquidity (Uniswap v3 style).
 * Creates the pool at the launch price, then opens a full-range position
 * with all the liquidity so it trades across the whole range.
 */
import {
  CLMM_PROGRAM_ID,
  CLMM_LOCK_PROGRAM_ID,
  CLMM_LOCK_AUTH_ID,
  DEVNET_PROGRAM_ID,
  Raydium,
  TxVersion,
  MAX_TICK,
  MIN_TICK,
  PersonalPositionLayout,
} from "@raydium-io/raydium-sdk-v2";
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import Decimal from "decimal.js";
import BN from "bn.js";
import { confirm } from "../lib/common";
import { DexResult, LaunchCtx } from "./types";
import { Transaction } from "@solana/web3.js";

export async function launchClmm(ctx: LaunchCtx): Promise<DexResult> {
  const { connection, payer, cluster } = ctx;
  const isDev = cluster === "devnet";
  const programId = isDev ? DEVNET_PROGRAM_ID.CLMM_PROGRAM_ID : CLMM_PROGRAM_ID;

  const raydium = await Raydium.load({
    connection,
    owner: payer,
    cluster: isDev ? "devnet" : "mainnet",
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });

  const ammConfigs = await raydium.api.getClmmConfigs();
  const ammConfig = ammConfigs.find((c: any) => c.index === 0) ?? ammConfigs[0];

  // price of mint1 (our token) in mint2 (WSOL)
  const price = new Decimal(ctx.liqSolLamports.toString())
    .div(new Decimal(10).pow(9))
    .div(new Decimal(ctx.liqTokenAmount.toString()).div(new Decimal(10).pow(ctx.mintDecimals)));

  const mintBase = {
    address: ctx.mint.toBase58(),
    decimals: ctx.mintDecimals,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    symbol: "",
    name: "",
  };
  const mintWsol = {
    address: NATIVE_MINT.toBase58(),
    decimals: 9,
    programId: TOKEN_PROGRAM_ID.toBase58(),
    symbol: "WSOL",
    name: "Wrapped SOL",
  };

  const txIds: string[] = [];

  const { execute, extInfo } = await raydium.clmm.createPool({
    programId,
    mint1: mintBase as any,
    mint2: mintWsol as any,
    ammConfig: ammConfig as any,
    initialPrice: price,
    txVersion: TxVersion.V0,
  });
  const { txId } = await execute({ sendAndConfirm: true });
  txIds.push(txId);
  const poolInfo = extInfo.mockPoolInfo;
  const poolId: string = extInfo.address.id;
  console.log(`  CLMM pool created: ${poolId} (tx ${txId})`);

  // Full-range position: liquidity trades across the entire curve.
  const tickSpacing = ammConfig.tickSpacing ?? poolInfo.config.tickSpacing;
  const tickLower = Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(MAX_TICK / tickSpacing) * tickSpacing;

  const { execute: execOpen, extInfo: posExt } =
    await raydium.clmm.openPositionFromBase({
      poolInfo,
      ownerInfo: { useSOLBalance: true },
      tickLower,
      tickUpper,
      base: "MintA",
      baseAmount: ctx.liqTokenAmount,
      otherAmountMax: ctx.liqSolLamports,
      txVersion: TxVersion.V0,
    });
  const { txId: openTx } = await execOpen({ sendAndConfirm: true });
  txIds.push(openTx);
  console.log(`  CLMM position opened: ${openTx}`);

  let lpAction = "position NFT kept in wallet";
  if (ctx.lpMode === "burn") {
    // Burning the position NFT locks the liquidity forever.
    const nftMint = posExt.nftMint;
    const nftAta = await getAssociatedTokenAddress(
      nftMint,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const tx = new Transaction().add(
      createBurnCheckedInstruction(
        nftAta,
        nftMint,
        payer.publicKey,
        1,
        0,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    const sig = await connection.sendTransaction(tx, [payer]);
    await confirm(connection, sig);
    txIds.push(sig);
    lpAction = `position NFT burned (liquidity locked forever): ${nftMint.toBase58()}`;
    console.log(`  Position NFT burned: ${sig}`);
  } else if (ctx.lpMode === "lock") {
    const posInfo = await connection.getAccountInfo(
      posExt.personalPosition
    );
    if (!posInfo) throw new Error("position account not found");
    const ownerPosition = PersonalPositionLayout.decode(posInfo.data);
    const { execute: execLock, extInfo: lockExt } =
      await raydium.clmm.lockPosition({
        programId: isDev
          ? DEVNET_PROGRAM_ID.CLMM_LOCK_PROGRAM_ID
          : CLMM_LOCK_PROGRAM_ID,
        authProgramId: isDev
          ? DEVNET_PROGRAM_ID.CLMM_LOCK_AUTH_ID
          : CLMM_LOCK_AUTH_ID,
        poolProgramId: programId,
        ownerPosition,
        txVersion: TxVersion.V0,
      });
    const { txId: lockTx } = await execLock({ sendAndConfirm: true });
    txIds.push(lockTx);
    lpAction = `position locked via Raydium ClmmLock (nft ${lockExt?.lockNftMint?.toBase58?.() ?? "?"})`;
    console.log(`  Position locked: ${lockTx}`);
  }

  return { dex: "raydium-clmm", poolId, txIds, lpAction };
}
