/**
 * Shared launch flow — used by the CLI and the MCP job runner.
 * Steps: createV1 mint+metadata -> mint 1B + team split -> revoke -> DEX pool -> LP mode.
 */
import {
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  AuthorityType,
} from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  createSignerFromKeypair,
  keypairIdentity,
  percentAmount,
} from "@metaplex-foundation/umi";
import { base58 } from "@metaplex-foundation/umi/serializers";
import {
  createV1,
  TokenStandard,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { DexResult, LpMode } from "../dex/types";
import { launchCpmm } from "../dex/cpmm";
import { launchClmm } from "../dex/clmm";
import { launchDlmm } from "../dex/dlmm";
import { launchWhirlpool } from "../dex/whirlpool";
import { launchDbc } from "../dex/dbc";

export const DECIMALS = 6;
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** BigInt(DECIMALS);

export interface LaunchOpts {
  rpc: string;
  cluster: "devnet" | "mainnet";
  payer: Keypair;
  name: string;
  symbol: string;
  uri: string;
  teamWallet: PublicKey;
  teamBps: number;
  liqSol: number;
  dex: "cpmm" | "clmm" | "dlmm" | "whirlpool" | "dbc";
  lpMode: LpMode;
  onLog?: (msg: string) => void;
}

export interface LaunchResult {
  mint: string;
  teamAta: string;
  dex: DexResult;
  txIds: string[];
}

export async function runLaunch(opts: LaunchOpts): Promise<LaunchResult> {
  const log = opts.onLog ?? ((m: string) => console.log(m));
  const { rpc, cluster, payer } = opts;
  const connection = new Connection(rpc, "confirmed");
  const teamBps = opts.teamBps ?? 1800;
  if (teamBps < 0 || teamBps > 10000) throw new Error("TEAM_BPS out of range");
  if (!opts.uri) log("warn: URI is empty — wallets will show no image.");

  if (cluster === "mainnet" && process.env.CONFIRM_MAINNET !== "YES")
    throw new Error(
      "mainnet launch refused: set CONFIRM_MAINNET=YES to spend real SOL " +
      "and create an irreversible on-chain token.");

  const teamAmount = (TOTAL_SUPPLY * BigInt(teamBps)) / 10_000n;
  const liqTokenAmount = TOTAL_SUPPLY - teamAmount;
  const liqSolLamports = BigInt(Math.round(opts.liqSol * LAMPORTS_PER_SOL));

  // preflight: liquidity + pool-create fee + mint/metadata/ATA rent + margin
  const required = liqSolLamports + 200_000_000n;
  const balance = await connection.getBalance(payer.publicKey);
  if (BigInt(balance) < required)
    throw new Error(
      `insufficient payer balance: ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL ` +
      `< required ${(Number(required) / LAMPORTS_PER_SOL).toFixed(3)} SOL ` +
      `(liquidity + ~0.2 SOL fees/rent).`);
  log(`cluster=${cluster} payer=${payer.publicKey.toBase58()} balance=${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  log(`mint=1B team=${teamBps / 100}% liq=${liqTokenAmount / 10n ** BigInt(DECIMALS)} + ${opts.liqSol} SOL dex=${opts.dex} lp=${opts.lpMode}`);

  // DBC path — the curve program creates mint/metadata/leftover itself;
  // no separate mint, team-split, or revoke transactions needed.
  if (opts.dex === "dbc") {
    const dbc = await launchDbc({
      connection,
      payer,
      cluster,
      mint: PublicKey.default, // unused — DBC generates its own mint
      mintDecimals: DECIMALS,
      liqTokenAmount: new BN(0), // zero initial liquidity is the point
      liqSolLamports: new BN(0),
      lpMode: opts.lpMode,
      name: opts.name,
      symbol: opts.symbol,
      uri: opts.uri,
      teamWallet: opts.teamWallet,
      teamBps,
    });
    log(`pool: ${dbc.result.poolId} | lp: ${dbc.result.lpAction}`);
    return {
      mint: dbc.mint.toBase58(),
      teamAta: opts.teamWallet.toBase58(), // leftover claimed by this wallet
      dex: dbc.result,
      txIds: dbc.txIds,
    };
  }

  // 1) createV1 — mint + metadata in one tx
  const mint = Keypair.generate();
  const umi = createUmi(rpc);
  const umiKp = umi.eddsa.createKeypairFromSecretKey(payer.secretKey);
  umi.use(keypairIdentity(umiKp));
  const umiMint = createSignerFromKeypair(
    umi,
    umi.eddsa.createKeypairFromSecretKey(mint.secretKey)
  );

  const mdSig = await createV1(umi, {
    mint: umiMint,
    authority: umi.identity,
    updateAuthority: umi.identity,
    name: opts.name,
    symbol: opts.symbol,
    uri: opts.uri,
    sellerFeeBasisPoints: percentAmount(0, 2),
    creators: [
      { address: umi.identity.publicKey, verified: true, share: 100 },
    ],
    tokenStandard: TokenStandard.Fungible,
    decimals: DECIMALS,
    collectionDetails: null,
    printSupply: null,
    isMutable: false,
  }).sendAndConfirm(umi);
  log(`mint+metadata created: ${mint.publicKey.toBase58()} (tx ${base58.deserialize(mdSig.signature)[0]})`);

  // 2) mint 1B + team share
  const payerAta = await getAssociatedTokenAddress(mint.publicKey, payer.publicKey);
  const teamAta = await getAssociatedTokenAddress(mint.publicKey, opts.teamWallet);

  const tx2 = new Transaction().add(
    createAssociatedTokenAccountInstruction(payer.publicKey, payerAta, payer.publicKey, mint.publicKey),
    createMintToInstruction(mint.publicKey, payerAta, payer.publicKey, TOTAL_SUPPLY),
    ...(teamAta.equals(payerAta)
      ? []
      : [createAssociatedTokenAccountInstruction(payer.publicKey, teamAta, opts.teamWallet, mint.publicKey)]),
    createTransferInstruction(payerAta, teamAta, payer.publicKey, teamAmount)
  );
  const sig2 = await sendAndConfirmTransaction(connection, tx2, [payer]);
  log(`1B minted + team allocated (tx ${sig2})`);

  // 3) revoke authorities
  try {
    const sig3 = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createSetAuthorityInstruction(mint.publicKey, payer.publicKey, AuthorityType.MintTokens, null),
        createSetAuthorityInstruction(mint.publicKey, payer.publicKey, AuthorityType.FreezeAccount, null)
      ),
      [payer]
    );
    log(`mint+freeze authority revoked (tx ${sig3})`);
  } catch (e) {
    log(`warn: authority revoke tx failed: ${e}`);
  }

  // 4) seed the pool
  const ctx = {
    connection,
    payer,
    cluster,
    mint: mint.publicKey,
    mintDecimals: DECIMALS,
    liqTokenAmount: new BN(liqTokenAmount.toString()),
    liqSolLamports: new BN(liqSolLamports.toString()),
    lpMode: opts.lpMode,
  };
  const dex = opts.dex;
  const result =
    dex === "cpmm"
      ? await launchCpmm(ctx)
      : dex === "clmm"
      ? await launchClmm(ctx)
      : dex === "dlmm"
      ? await launchDlmm(ctx)
      : await launchWhirlpool(ctx);

  log(`pool: ${result.poolId} | lp: ${result.lpAction}`);
  return {
    mint: mint.publicKey.toBase58(),
    teamAta: teamAta.toBase58(),
    dex: result,
    txIds: [base58.deserialize(mdSig.signature)[0], sig2, ...result.txIds],
  };
}
