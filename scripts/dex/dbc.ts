/**
 * Meteora Dynamic Bonding Curve — pump.fun-style launch with ZERO initial
 * liquidity. The DBC program creates the mint itself (1B supply), puts the
 * leftover (team 18%) aside for `leftoverReceiver`, and sells the rest on a
 * virtual curve. Buys accumulate SOL; at `DBC_THRESHOLD_SOL` the liquidity
 * migrates to a real DAMM V2 pool (Jupiter/Dexscreener indexable).
 *
 * LP mode mapping (applied at migration):
 *   keep → creator gets the graduated LP unlocked
 *   burn/lock → creator's share becomes PERMANENTLY LOCKED LP
 */
import {
  ActivationType,
  BaseFeeMode,
  buildCurve,
  CollectFeeMode,
  deriveDbcPoolAddress,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { DexResult, LaunchCtx } from "./types";

const THRESHOLD_SOL = Number(process.env.DBC_THRESHOLD_SOL ?? 30); // curve → DAMM V2 at this SOL
// % of TOTAL supply seeded into the DAMM pool at graduation. Pump.fun-style
// split: ~20% migrates, ~62% sells on the curve, 18% team leftover.
// Constraint: migrate% + leftover% must not exceed 100 (and leave enough
// curve supply — too high a migrate% makes the curve math underflow).
const SUPPLY_ON_MIGRATION_PCT = Number(process.env.DBC_MIGRATE_PCT ?? 20);
const DECIMALS = 6;

export interface DbcOpts extends LaunchCtx {
  name: string;
  symbol: string;
  uri: string;
  teamWallet: PublicKey;
  teamBps: number;
}

export async function launchDbc(opts: DbcOpts): Promise<{
  result: DexResult;
  mint: PublicKey;
  txIds: string[];
}> {
  const { connection, payer } = opts;
  const client = new DynamicBondingCurveClient(connection, "confirmed");

  const configKp = Keypair.generate(); // our own pool config (creator keeps control/fees)
  const mintKp = Keypair.generate(); // base mint — created BY the DBC program
  const leftoverTokens = Math.floor(
    (1_000_000_000 * opts.teamBps) / 10_000
  ); // team share withheld from the curve

  const curveConfig = buildCurve({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable, // metadata locked forever
      totalTokenSupply: 1_000_000_000,
      leftover: leftoverTokens,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          startingFeeBps: 100, // flat 1% swap fee on the curve
          endingFeeBps: 100,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken, // fees paid in SOL
      creatorTradingFeePercentage: 100, // creator (payer) keeps 100% of trading fees
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps200,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    // DBC requires >=10% of migrated LP permanently locked (protocol anti-rug)
    liquidityDistribution:
      opts.lpMode === "keep"
        ? {
            partnerLiquidityPercentage: 0,
            partnerPermanentLockedLiquidityPercentage: 0,
            creatorLiquidityPercentage: 90,
            creatorPermanentLockedLiquidityPercentage: 10,
          }
        : {
            partnerLiquidityPercentage: 0,
            partnerPermanentLockedLiquidityPercentage: 0,
            creatorLiquidityPercentage: 0,
            creatorPermanentLockedLiquidityPercentage: 100,
          },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Slot,
    percentageSupplyOnMigration: SUPPLY_ON_MIGRATION_PCT,
    migrationQuoteThreshold: THRESHOLD_SOL,
  });

  const tx = await client.partner.createConfigAndPool({
    payer: payer.publicKey,
    config: configKp.publicKey,
    feeClaimer: payer.publicKey, // trading fees accrue to payer
    leftoverReceiver: opts.teamWallet, // team allocation claimed from here
    quoteMint: NATIVE_MINT,
    ...curveConfig,
    preCreatePoolParam: {
      baseMint: mintKp.publicKey,
      name: opts.name,
      symbol: opts.symbol,
      uri: opts.uri,
      poolCreator: payer.publicKey,
    },
  });

  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  tx.sign(payer, configKp, mintKp);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");

  const poolId = deriveDbcPoolAddress(
    configKp.publicKey,
    mintKp.publicKey,
    NATIVE_MINT
  );
  const lpAction =
    opts.lpMode === "keep"
      ? `creator gets graduated DAMM V2 LP when curve hits ${THRESHOLD_SOL} SOL`
      : `graduated LP permanently locked (${opts.lpMode}) at ${THRESHOLD_SOL} SOL`;

  console.log(`  DBC curve live: ${poolId.toBase58()} (tx ${sig})`);
  return {
    mint: mintKp.publicKey,
    txIds: [sig],
    result: {
      dex: "meteora-dbc",
      poolId: poolId.toBase58(),
      lpAction,
      txIds: [sig],
    },
  };
}
