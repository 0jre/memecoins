# memecoins-mcp

A Python **MCP** (Model Context Protocol) server that lets AI agents create,
launch and manage Solana SPL memecoins — 100% logic, no user interface.

An agent connects over stdio, calls `launch_memecoin`, and gets back a job it
can poll until the token is live on a DEX with liquidity, immutable metadata
and revoked mint/freeze authority.

## What it does

- Creates a 1,000,000,000-supply SPL token (6 decimals, classic Token program)
- Sends `TEAM_BPS`% to a team wallet; the rest seeds initial liquidity
- Creates Metaplex metadata, `isMutable: false` (immutable)
- Revokes mint + freeze authority — supply permanently locked
- Opens a pool on the chosen DEX and handles LP per `LP_MODE`
- Successful launches become routable on Jupiter and indexed by
  Dexscreener/Birdeye within minutes

## Architecture

```
AI agent  ──stdio──>  memecoins_mcp (FastMCP, Python)
                          │  async jobs, registry, preflight
                          ▼
                scripts/ (TypeScript, on-chain runners)
                launch-dex.ts · lp-ops.ts · dex/*
```

The Python layer orchestrates; the TypeScript layer executes on-chain
transactions with the official Raydium/Orca/Meteora/Metaplex SDKs (TS-only).
See [docs/architecture.md](docs/architecture.md).

## Supported venues (`DEX=`)

| `dex` | venue | pool type | lp_mode |
|---|---|---|---|
| `cpmm` | Raydium CPMM | constant product | burn, keep, lock |
| `clmm` | Raydium CLMM | concentrated (full-range) | burn, keep, lock |
| `dlmm` | Meteora DLMM | bins | keep only |
| `whirlpool` | Orca Whirlpool | concentrated (full-range) | burn, keep |
| `dbc` | Meteora Dynamic Bonding Curve | curve → DAMM V2 | keep, lock, burn |

`dbc` is the pump.fun-style model: zero initial liquidity — the curve creates
the mint and migrates to a real DAMM V2 pool at `DBC_THRESHOLD_SOL`.

## MCP tools

| tool | purpose |
|---|---|
| `get_config` | cluster, payer, venues and required env vars |
| `preflight` | payer balance vs estimated launch cost |
| `launch_memecoin` | start an async launch → `job_id` |
| `get_job` / `list_jobs` | job status, log tail and result |
| `list_launches` / `get_token` | registry of launched tokens |
| `burn_cpmm_lp` / `lock_cpmm_lp` | post-launch LP operations (CPMM) |

Plus the `launch_guide` prompt that walks an agent through the full flow.
Full reference: [docs/mcp-tools.md](docs/mcp-tools.md).

## Setup

```bash
# TypeScript on-chain engine
npm install

# MCP server
python3.12 -m venv .venv && .venv/bin/pip install -e .
```

Register the server with an MCP client:

```json
{
  "mcpServers": {
    "memecoins": {
      "command": "/path/to/memecoins/.venv/bin/memecoins-mcp",
      "env": {
        "CLUSTER": "devnet",
        "PAYER": "/path/to/id.json"
      }
    }
  }
}
```

More on client setup and the direct-CLI fallback in
[docs/getting-started.md](docs/getting-started.md).

## Environment variables

`CLUSTER`, `RPC_URL`, `PAYER`, `TEAM_WALLET`, `TEAM_BPS`, `LIQ_SOL`, `DEX`,
`LP_MODE`, `CONFIRM_MAINNET=YES` (mainnet safety gate), `DBC_THRESHOLD_SOL`,
`DBC_MIGRATE_PCT`, `MEMECOINS_HOME` (job/registry store root).

Full reference: [docs/environment.md](docs/environment.md).

## Security notes

- **Single-operator**: the payer keypair stays server-side and signs every
  transaction — do not expose the MCP server to untrusted clients.
- Mainnet launches are gated by `CONFIRM_MAINNET=YES`.
- Meteora `dbc` permanently locks ≥10% of migrated LP (anti-rug, enforced
  by the program itself).

## Costs (approximate)

| step | cost |
|---|---|
| mint + ATAs + metadata | ~0.007 SOL |
| CPMM pool create fee | ~0.15 SOL (Raydium) |
| CLMM/DLMM/Whirlpool | position/tick-array rent, ~0.01–0.05 SOL |
| `LIQ_SOL` | your choice — the market-cap basis |
| `dbc` | no initial liquidity |

## Status

Venues `cpmm`, `whirlpool`, `dlmm` and `dbc` verified end-to-end on localnet
with real program binaries (`scripts/val-foreground.sh`).
`npx tsc --noEmit` clean; MCP stdio handshake validated.

## License

MIT
