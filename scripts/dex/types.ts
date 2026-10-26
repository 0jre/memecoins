import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export type LpMode = "burn" | "keep" | "lock";

export interface LaunchCtx {
  connection: Connection;
  payer: Keypair;
  cluster: "devnet" | "mainnet";
  /** The freshly created SPL mint (our memecoin). */
  mint: PublicKey;
  mintDecimals: number;
  /** Token amount (base units) destined for initial liquidity. */
  liqTokenAmount: BN;
  /** SOL amount (lamports) paired into the initial liquidity. */
  liqSolLamports: BN;
  lpMode: LpMode;
}

export interface DexResult {
  dex: string;
  poolId: string;
  txIds: string[];
  lpAction: string;
}

export type DexAdapter = (ctx: LaunchCtx) => Promise<DexResult>;
