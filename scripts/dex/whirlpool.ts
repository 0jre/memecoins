/**
 * Orca Whirlpool — concentrated liquidity pool.
 * Creates a pool at the launch price and opens a full-range position.
 *
 * LP modes: keep = position NFT in wallet; burn = burn the NFT, which locks
 * the liquidity permanently; lock = unsupported on Orca (kept, warning).
 */
import {
  buildWhirlpoolClient,
  increaseLiquidityQuoteByInputToken,
  NO_TOKEN_EXTENSION_CONTEXT,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG,
  PriceMath,
  TickUtil,
  WhirlpoolContext,
} from "@orca-so/whirlpools-sdk";
import { Percentage } from "@orca-so/common-sdk";
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import Decimal from "decimal.js";
import BN from "bn.js";
import { confirm } from "../lib/common";
import { DexResult, LaunchCtx } from "./types";

const TICK_SPACING = 64; // 64 = standard 0.25% tier; splash pools use 32896

// Minimal anchor-Wallet shim (whirlpools-sdk only needs signTransaction).
class LocalWallet {
  payer: Keypair;
  constructor(payer: Keypair) {
    this.payer = payer;
  }
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    if (tx instanceof Transaction) tx.partialSign(this.payer);
    else tx.sign([this.payer]);
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]> {
    for (const tx of txs) await this.signTransaction(tx);
    return txs;
  }
}

export async function launchWhirlpool(ctx: LaunchCtx): Promise<DexResult> {
  const { connection, payer } = ctx;
  if (ctx.lpMode === "lock") {
    console.warn(
      "  Orca positions can't be locked — keeping NFT (LP_MODE=lock ignored)"
    );
  }

  const wallet = new LocalWallet(payer) as any;
  const wpCtx = WhirlpoolContext.from(
    connection,
    wallet,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(wpCtx);

  // canonical ordering: mintA < mintB by byte repr — required by Whirlpool
  const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
  const tokenFirst = Buffer.compare(ctx.mint.toBuffer(), WSOL.toBuffer()) < 0;
  const mintA = tokenFirst ? ctx.mint : WSOL;
  const mintB = tokenFirst ? WSOL : ctx.mint;
  const decA = tokenFirst ? ctx.mintDecimals : 9;
  const decB = tokenFirst ? 9 : ctx.mintDecimals;

  // SOL per token in human units; pool price = mintB per 1 mintA
  const solPerToken = new Decimal(ctx.liqSolLamports.toString())
    .div(new Decimal(10).pow(9))
    .div(
      new Decimal(ctx.liqTokenAmount.toString()).div(
        new Decimal(10).pow(ctx.mintDecimals)
      )
    );
  const price = tokenFirst ? solPerToken : new Decimal(1).div(solPerToken);

  const rawTick = PriceMath.priceToTickIndex(price, decA, decB);
  const initialTick = TickUtil.getInitializableTickIndex(
    rawTick,
    TICK_SPACING
  );

  const txIds: string[] = [];

  const { poolKey, tx } = await client.createPool(
    ORCA_WHIRLPOOLS_CONFIG,
    mintA,
    mintB,
    TICK_SPACING,
    initialTick,
    payer.publicKey
  );
  const sig1 = await tx.buildAndExecute();
  txIds.push(sig1);
  console.log(`  Whirlpool created: ${poolKey.toBase58()} (tx ${sig1})`);

  const pool = await client.getPool(poolKey);

  // near-full-range position — ±400000 stays inside tick-array bounds
  // (the ±443600 extremes overflow the max tick-array index for spacing 64)
  const tickLower = TickUtil.getInitializableTickIndex(
    -400000,
    TICK_SPACING
  );
  const tickUpper = TickUtil.getInitializableTickIndex(
    400000,
    TICK_SPACING
  );

  const quote = increaseLiquidityQuoteByInputToken(
    ctx.mint,
    new Decimal(ctx.liqTokenAmount.toString()).div(
      new Decimal(10).pow(ctx.mintDecimals)
    ), // SDK expects input in UI units
    tickLower,
    tickUpper,
    Percentage.fromFraction(5, 100), // 5% slippage tolerance
    pool,
    NO_TOKEN_EXTENSION_CONTEXT
  );

  // tick arrays must exist before the position can be opened
  const taInit = await pool.initTickArrayForTicks(
    [tickLower, tickUpper],
    payer.publicKey
  );
  if (taInit) {
    const sigTa = await taInit.buildAndExecute();
    txIds.push(sigTa);
    console.log(`  Tick arrays initialized: ${sigTa}`);
  }

  const { positionMint, tx: openTx } = await pool.openPosition(
    tickLower,
    tickUpper,
    quote
  );
  const sig2 = await openTx.buildAndExecute();
  txIds.push(sig2);
  console.log(`  Position opened: ${sig2}`);

  let lpAction = `position NFT ${positionMint.toBase58()} kept`;
  if (ctx.lpMode === "burn") {
    const nftAta = await getAssociatedTokenAddress(
      positionMint,
      payer.publicKey
    );
    const burnTx = new Transaction().add(
      createBurnCheckedInstruction(
        nftAta,
        positionMint,
        payer.publicKey,
        1,
        0,
        [],
        TOKEN_PROGRAM_ID
      )
    );
    const sig = await connection.sendTransaction(burnTx, [payer]);
    await confirm(connection, sig);
    txIds.push(sig);
    lpAction = `position NFT burned — liquidity locked forever`;
    console.log(`  Position NFT burned: ${sig}`);
  }

  return {
    dex: "orca-whirlpool",
    poolId: poolKey.toBase58(),
    txIds,
    lpAction,
  };
}
