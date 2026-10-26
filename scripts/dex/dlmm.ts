/**
 * Meteora DLMM pool — discrete liquidity bins, dynamic fees.
 * Creates a permissionless LB pair at the launch price and seeds a wide
 * spot-liquidity position.
 *
 * NOTE: DLMM positions live in a PDA owned by the pool — they cannot be
 * burned or transferred. LP_MODE=burn/lock is not supported here and the
 * position stays withdrawable (keep). Use CPMM/CLMM for permanent locks.
 */
import DLMM, {
  ActivationType,
  StrategyType,
  deriveCustomizablePermissionlessLbPair,
  getPriceOfBinByBinId,
  LBCLMM_PROGRAM_IDS,
} from "@meteora-ag/dlmm";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { sendTx } from "../lib/common";
import { DexResult, LaunchCtx } from "./types";

const BIN_STEP = 50; // 0.5% per bin — standard memecoin step
const FEE_BPS = 200; // 2% base swap fee
// ±34 bins = position width 69 — the position account is allocated in
// initialize_position via inner realloc, which caps at 10240 bytes;
// wider positions (>~70 bins) fail with "Failed to reallocate account data".
const RANGE_BINS = Number(process.env.RANGE_BINS ?? 34);

export async function launchDlmm(ctx: LaunchCtx): Promise<DexResult> {
  const { connection, payer, cluster } = ctx;
  if (ctx.lpMode !== "keep") {
    console.warn(
      "  DLMM positions cannot be burned/locked — keeping position (LP_MODE ignored)"
    );
  }

  const programId = new PublicKey(
    LBCLMM_PROGRAM_IDS[cluster === "devnet" ? "devnet" : "mainnet-beta"]
  );

  const tokenX = ctx.mint;
  const tokenY = NATIVE_MINT;

  // Target raw price (lamportsY per lamportX) -> bin index.
  // DLMM bin price = y_raw / x_raw, bin spacing = (1 + binStep/10000).
  const rawPrice =
    ctx.liqSolLamports.toNumber() / ctx.liqTokenAmount.toNumber();
  const stepBase = 1 + BIN_STEP / 10_000;
  let activeId = Math.round(Math.log(rawPrice) / Math.log(stepBase));
  // sanity: the helper's price at our bin should be near the target
  const check = getPriceOfBinByBinId(BIN_STEP, activeId);
  console.log(
    `  target raw price ${rawPrice.toExponential(3)} -> activeId ${activeId} (bin price ${check})`
  );

  const txIds: string[] = [];

  const createTx = await DLMM.createCustomizablePermissionlessLbPair(
    connection,
    new BN(BIN_STEP),
    tokenX,
    tokenY,
    new BN(activeId),
    new BN(FEE_BPS),
    ActivationType.Slot,
    false, // hasAlphaVault
    payer.publicKey,
    null as any, // activationPoint -> immediate
    false, // creatorPoolOnOffControl
    undefined as any,
    undefined as any,
    { cluster: cluster === "devnet" ? "devnet" : "mainnet-beta" } as any
  );

  const sig1 = await sendTx(connection, payer, createTx.instructions);
  txIds.push(sig1);

  const [lbPair] = deriveCustomizablePermissionlessLbPair(
    tokenX,
    tokenY,
    programId
  );
  console.log(`  DLMM pool created: ${lbPair.toBase58()} (tx ${sig1})`);

  const dlmm = await DLMM.create(connection, lbPair, {
    cluster: cluster === "devnet" ? "devnet" : "mainnet-beta",
  } as any);

  const minBinId = activeId - RANGE_BINS;
  const maxBinId = activeId + RANGE_BINS;

  // The LP position is a fresh account owned by the DLMM program.
  const positionKp = Keypair.generate();

  const addTx = await dlmm.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: positionKp.publicKey,
    totalXAmount: ctx.liqTokenAmount,
    totalYAmount: ctx.liqSolLamports,
    strategy: {
      minBinId,
      maxBinId,
      strategyType: StrategyType.Spot,
    },
    user: payer.publicKey,
    slippage: 1, // %
  });

  const sig2 = await sendTx(
    connection,
    payer,
    addTx.instructions,
    [positionKp]
  );
  txIds.push(sig2);
  console.log(`  DLMM liquidity added (${sig2})`);

  return {
    dex: "meteora-dlmm",
    poolId: lbPair.toBase58(),
    txIds,
    lpAction: `position ${positionKp.publicKey.toBase58()} (withdrawable — DLMM cannot lock)`,
  };
}
