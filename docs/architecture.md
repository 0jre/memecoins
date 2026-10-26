# Architecture

## Layers

```
AI agent (Claude, Cursor, any MCP client)
        │  stdio — JSON-RPC
        ▼
memecoins_mcp/                      Python, FastMCP (mcp>=1.9,<2)
  server.py                         tools + prompt surface
  jobs.py                           async job runner (threads + subprocess)
  registry.py                       JSON store (data/registry.json, data/jobs/)
        │  spawns: npx ts-node …, parses "RESULT {json}"
        ▼
scripts/                            TypeScript, official DEX SDKs
  launch-dex.ts                     full launch pipeline
  lp-ops.ts                         post-launch LP ops (burn/lock)
  dex/                              one adapter per venue
  lib/                              shared launch flow, config, keypair
```

## Why two languages

The Raydium, Orca, Meteora and Metaplex SDKs are TypeScript-only. Reimplementing
their transaction serialization in Python would duplicate hundreds of lines of
already-verified code. So the Python MCP layer handles orchestration (async
jobs, registry, preflight, config) and delegates on-chain work to the TS
runners through a strict output contract.

## The `RESULT {json}` contract

Both runners print logs for humans and, when `LAUNCH_JSON=1` (or always for
`lp-ops.ts`), emit a single machine-readable line:

```
RESULT {"mint":"…","dex":"cpmm","poolId":"…","txIds":[…],…}
```

`jobs.py` captures the last `RESULT ` line of the subprocess stdout and stores
it as the job's `result`. On failure the runner emits `RESULT {"error":"…"}`
and exits non-zero.

## Jobs

`launch_memecoin`, `burn_cpmm_lp` and `lock_cpmm_lp` are **async**: the tool
returns immediately with `{job_id, status: "running"}`. The agent polls
`get_job` (or lists via `list_jobs`) until `status` is `succeeded`/`failed`.

Each job is a dict persisted to `data/jobs/<id>.json`:

```json
{
  "id": "…", "kind": "launch|lp-op",
  "status": "running|succeeded|failed",
  "meta": { "dex": "cpmm", "name": "…", … },
  "log": "…last lines of subprocess output…",
  "result": { "mint": "…", "poolId": "…" },
  "createdAt": 1730…, "finishedAt": 1730…
}
```

## Registry

`data/registry.json` holds two lists:

- `tokens` — every successful launch, keyed by mint address, with pool id,
  cluster, links (solscan/dexscreener), team ATA and tx ids.
- `ops` — post-launch LP operations (burn/lock) for audit.

`MEMECOINS_HOME` overrides the store root (default: repo root / `data/`).

## Launch pipeline (`scripts/launch-dex.ts`)

1. Create SPL mint (6 decimals), mint 1B to payer ATA.
2. Transfer `TEAM_BPS`% to `TEAM_WALLET` ATA.
3. Create Metaplex metadata (`isMutable: false`).
4. Revoke mint + freeze authority.
5. Create the DEX pool via the venue adapter (`scripts/dex/<dex>.ts`) and
   seed it with the remaining supply + `LIQ_SOL`.
6. Apply `LP_MODE` to the resulting LP token/position (burn / keep / lock).
7. Print `RESULT {json}` with mint, poolId, lpAction, teamAta, txIds and links.

## Post-launch ops (`scripts/lp-ops.ts`)

`npx ts-node scripts/lp-ops.ts <burn|lock> <poolId>` — ported from the former
dashboard; works on the payer's LP token/position for a CPMM pool and emits the
same `RESULT` contract.
