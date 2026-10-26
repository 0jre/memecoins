# memecoins-mcp

A Python **MCP** (Model Context Protocol) server for creating Solana SPL
memecoins via AI agents — 100% logic, no interface.

## Architecture

```
AI agent  ──stdio──>  memecoins_mcp (FastMCP, Python)
                          │  orchestrates jobs, registry and preflight
                          ▼
                scripts/ (TypeScript, on-chain runners)
                launch-dex.ts · lp-ops.ts · dex/*
```

- `memecoins_mcp/server.py` — MCP tools/prompt: async launch, lp ops,
  registry, preflight, config.
- `memecoins_mcp/jobs.py` — thread jobs that run the TS runners
  (`npx ts-node`) and capture the `RESULT {json}` line.
- `memecoins_mcp/registry.py` — JSON store at `data/registry.json` +
  `data/jobs/`.
- `scripts/` — TypeScript launch engine (official Raydium/Orca/Meteora/
  Metaplex SDKs). Kept as the on-chain executor: those DEX SDKs are
  TS-only, so the MCP does not reimplement transaction serialization
  in Python.

## MCP tools

| tool | purpose |
|---|---|
| `get_config` | cluster, payer, venues and required env vars |
| `preflight` | payer balance vs estimated cost |
| `launch_memecoin` | start async launch → `job_id` |
| `get_job` / `list_jobs` | job status, log and result |
| `list_launches` / `get_token` | registry of launched tokens |
| `burn_cpmm_lp` / `lock_cpmm_lp` | post-launch LP ops (CPMM) |

The `launch_guide` prompt walks the agent through the full flow.

## Venues (`DEX=`)

| `dex` | venue | pool | lp_mode |
|---|---|---|---|
| `cpmm` | Raydium CPMM | constant product | burn, keep, lock |
| `clmm` | Raydium CLMM | concentrated (full-range) | burn, keep, lock |
| `dlmm` | Meteora DLMM | bins | keep only |
| `whirlpool` | Orca Whirlpool | concentrated (full-range) | burn, keep |
| `dbc` | Meteora Dynamic Bonding Curve | curve → DAMM V2 | keep, lock, burn |

`dbc` is the pump.fun model: zero initial liquidity — the curve creates
the mint, buyers' SOL accumulates and at `DBC_THRESHOLD_SOL` (default
30) it migrates to a real DAMM V2 pool. Meteora forces ≥10% of migrated
LP to stay permanently locked (anti-rug). Knobs: `DBC_THRESHOLD_SOL`,
`DBC_MIGRATE_PCT`.

## Setup & usage

```bash
# TS engine (on-chain runners)
npm install

# MCP server
python3.12 -m venv .venv && .venv/bin/pip install -e .
```

Register with an MCP client (e.g. `.mcp.json` / Claude / Cursor):

```json
{
  "mcpServers": {
    "memecoins": {
      "command": "/path/to/memecoins/.venv/bin/memecoins-mcp",
      "env": { "CLUSTER": "devnet", "PAYER": "/path/to/id.json" }
    }
  }
}
```

### Direct CLI (no MCP)

```bash
# devnet
CLUSTER=devnet DEX=cpmm LP_MODE=burn LIQ_SOL=1 \
  NAME="My Coin" SYMBOL="MEME" URI="https://.../meta.json" npm run launch

# lp ops
npm run lp -- burn <poolId>
npm run lp -- lock <poolId>
```

Both runners also support `LAUNCH_JSON=1`/`RESULT {json}` output — the
contract the MCP uses.

## Env vars

`CLUSTER`, `RPC_URL`, `PAYER`, `TEAM_WALLET`, `TEAM_BPS`, `LIQ_SOL`,
`DEX`, `LP_MODE`, `CONFIRM_MAINNET=YES` (mainnet gate),
`DBC_THRESHOLD_SOL`, `DBC_MIGRATE_PCT`, `MEMECOINS_HOME` (store root).

## Resulting token

- 1,000,000,000 supply, 6 decimals, classic SPL Token
- `TEAM_BPS`% → team wallet; the rest → initial liquidity
- mint + freeze authority revoked (supply permanently locked)
- immutable metadata, creator = payer (verified)
- on a successful launch the token is routable on Jupiter and indexed by
  Dexscreener/Birdeye within minutes (CPMM/CLMM/DLMM are all indexed)

## Costs (approximate)

| step | cost |
|---|---|
| mint + ATAs + metadata | ~0.007 SOL |
| CPMM pool create fee | ~0.15 SOL (Raydium) |
| CLMM/DLMM/Whirlpool | position/tick-array rent, ~0.01–0.05 SOL |
| `LIQ_SOL` | your choice — this IS the market cap basis |
| `dbc` | no initial liquidity |

## Verified

Venues `cpmm`, `whirlpool`, `dlmm` and `dbc` verified end-to-end on
localnet (real program binaries via `--bpf-program` — see
`scripts/val-foreground.sh`). `npx tsc --noEmit` clean.

## Notes

- Windows: run inside WSL Ubuntu (`scripts/setup-wsl.sh`).
- Single-operator: the payer keypair stays server-side and signs every
  operation — do not expose the MCP to untrusted clients.
