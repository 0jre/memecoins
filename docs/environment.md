# Environment variables

Set these on the MCP server process (e.g. in the client's `env` block) or in
the shell when running the TS runners directly.

## Core

| var | default | meaning |
|---|---|---|
| `CLUSTER` | `devnet` | `devnet` / `mainnet-beta` |
| `RPC_URL` | cluster public RPC | Solana JSON-RPC endpoint |
| `PAYER` | `~/.config/solana/id.json` | payer keypair path (signs everything) |
| `TEAM_WALLET` | payer pubkey | wallet receiving `TEAM_BPS`% |
| `TEAM_BPS` | `1800` | team allocation in basis points (18%) |
| `LIQ_SOL` | `1` | SOL seeded into the pool |
| `NAME` / `SYMBOL` / `URI` | — | token name, ticker, metadata JSON URL |

## Venue

| var | default | meaning |
|---|---|---|
| `DEX` | `cpmm` | `cpmm`/`clmm`/`dlmm`/`whirlpool`/`dbc` |
| `LP_MODE` | `burn` | `burn`/`keep`/`lock` (per-venue support varies) |
| `DBC_THRESHOLD_SOL` | `30` | curve → DAMM V2 migration threshold |
| `DBC_MIGRATE_PCT` | `20` | % of supply that seeds migration |

## Safety & storage

| var | default | meaning |
|---|---|---|
| `CONFIRM_MAINNET` | — | must equal `YES` to allow mainnet launches |
| `MEMECOINS_HOME` | repo root | root for `data/registry.json` and `data/jobs/` |
| `LAUNCH_JSON` | — | `1` makes TS runners emit `RESULT {json}` (set by jobs.py) |

## Secrets

Keep `PAYER` on a filesystem-only path — never commit keypairs. `data/` and
`.env*` files are gitignored.
