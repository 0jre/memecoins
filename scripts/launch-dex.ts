/**
 * CLI wrapper — see scripts/lib/launch-flow.ts for the actual flow.
 * Env vars documented below; run:  npm run launch
 */
import { clusterRpc, env, envNum, loadPayer } from "./lib/common";
import { LpMode } from "./dex/types";
import { runLaunch } from "./lib/launch-flow";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const { rpc, cluster } = clusterRpc();
  const payer = loadPayer();

  const teamWallet = new PublicKey(
    env(
      "TEAM_WALLET",
      "HrbEX7cLgPe7mr6bg726x4emc9bavFBUTHcsJoXBaHTs"
    )
  );

  const result = await runLaunch({
    rpc,
    cluster,
    payer,
    name: env("NAME", "Meme Coin"),
    symbol: env("SYMBOL", "MEME"),
    uri: env("URI", ""),
    teamWallet,
    teamBps: envNum("TEAM_BPS", 1800),
    liqSol: envNum("LIQ_SOL", 1),
    dex: (env("DEX", "cpmm") || "cpmm").toLowerCase() as any,
    lpMode: (env("LP_MODE", "burn") || "burn").toLowerCase() as LpMode,
  });

  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  const payload = {
    mint: result.mint,
    dex: result.dex.dex,
    poolId: result.dex.poolId,
    lpAction: result.dex.lpAction,
    teamAta: result.teamAta,
    txIds: result.txIds,
    cluster,
    solscan: `https://solscan.io/token/${result.mint}${suffix}`,
    dexscreener: `https://dexscreener.com/solana/${result.dex.poolId}`,
  };

  if (process.env.LAUNCH_JSON === "1") {
    // single machine-readable line for the MCP runner
    console.log("RESULT " + JSON.stringify(payload));
    return;
  }

  console.log("\n=== LAUNCH COMPLETE ===");
  console.log("mint:    ", result.mint);
  console.log("dex:     ", result.dex.dex);
  console.log("pool:    ", result.dex.poolId);
  console.log("lp:      ", result.dex.lpAction);
  console.log("team ata:", result.teamAta);
  console.log(`solscan: ${payload.solscan}`);
  console.log(`dexscreener: ${payload.dexscreener}`);
}

main().catch((e) => {
  if (process.env.LAUNCH_JSON === "1") {
    console.log("RESULT " + JSON.stringify({ error: String(e?.message ?? e) }));
  } else {
    console.error(e);
  }
  process.exit(1);
});
