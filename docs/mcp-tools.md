# MCP tools reference

All tools are synchronous calls that return JSON objects.

## `get_config`

Current server configuration.

```json
{
  "cluster": "devnet",
  "rpcUrl": "https://api.devnet.solana.com",
  "payer": "Gxx…",
  "teamWallet": "…",
  "teamBps": 1800,
  "venues": { "cpmm": {"lpModes": ["burn","keep","lock"], …}, … },
  "store": "/path/to/data"
}
```

## `preflight`

Balance check before spending. Args: `dex` (optional).

Returns estimated cost for the chosen dex and payer SOL balance, e.g.
`{"ok": true, "balanceSol": 2.4, "estimatedCostSol": 0.2}` or a warning when
balance is short.

## `launch_memecoin`

Starts an async launch job.

| arg | type | required |
|---|---|---|
| `name` | string | yes |
| `symbol` | string | yes |
| `uri` | string (metadata JSON URL) | yes |
| `dex` | `cpmm|clmm|dlmm|whirlpool|dbc` | no (default `cpmm`) |
| `liqSol` | number | no (default `LIQ_SOL` env) |
| `lpMode` | `burn|keep|lock` | no (default `LP_MODE` env) |

Returns `{ "jobId": "…", "status": "running" }`. Poll with `get_job`.

Errors: `invalid dex: <x>`; `mainnet launch refused (set CONFIRM_MAINNET=YES)`.

## `get_job` / `list_jobs`

- `get_job(jobId)` → the full job object (status, log tail, result).
- `list_jobs(limit)` → recent jobs, newest first.

A succeeded launch job's `result` contains:

```json
{
  "mint": "…", "dex": "cpmm", "poolId": "…", "lpAction": "burn",
  "teamAta": "…", "txIds": ["…"], "cluster": "devnet",
  "solscan": "https://solscan.io/token/…?cluster=devnet",
  "dexscreener": "https://dexscreener.com/solana/…"
}
```

## `list_launches` / `get_token`

- `list_launches()` → all tokens in the registry.
- `get_token(mint)` → one token's registry entry (pool, links, team ATA).

## `burn_cpmm_lp` / `lock_cpmm_lp`

Async jobs that burn or lock the payer's LP for a CPMM pool. Arg: `poolId`.
Returns `{ "jobId": "…", "status": "running" }`; result includes the op tx id.

## Prompt: `launch_guide`

A ready-made prompt that instructs the agent how to orchestrate a launch:
config → preflight → launch → poll job → report the mint/pool/links.
