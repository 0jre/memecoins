# Getting started

## 1. Install

```bash
npm install                                    # TS on-chain engine
python3.12 -m venv .venv && .venv/bin/pip install -e .
```

Requires Python ≥3.10 and Node.js (with `npx`).

## 2. Configure

Minimum env: `CLUSTER=devnet`, `PAYER=/path/to/id.json`. Fund the payer via
`faucet.solana.com` for devnet.

## 3. Register with an MCP client

```json
{
  "mcpServers": {
    "memecoins": {
      "command": "/path/to/memecoins/.venv/bin/memecoins-mcp",
      "env": {
        "CLUSTER": "devnet",
        "PAYER": "/path/to/id.json",
        "TEAM_WALLET": "<pubkey>",
        "LIQ_SOL": "1"
      }
    }
  }
}
```

Works with Claude Desktop, Cursor, or any stdio MCP client.

## 4. Launch via an agent

Tell the agent something like:

> Launch a devnet memecoin called "Test Coin" (symbol TEST) with metadata URI
> https://example.com/meta.json on Raydium CPMM, 1 SOL liquidity, LP burned.

The agent will call `preflight`, `launch_memecoin`, then poll `get_job` and
return the mint, pool id and explorer links.

## Direct CLI (no MCP)

The TS runners are standalone:

```bash
CLUSTER=devnet DEX=cpmm LP_MODE=burn LIQ_SOL=1 \
  NAME="My Coin" SYMBOL="MEME" URI="https://…/meta.json" npm run launch

npm run lp -- burn <poolId>
npm run lp -- lock <poolId>
```

## Localnet verification

`scripts/val-foreground.sh` boots a validator with the real program binaries
(`--bpf-program`) so venues can be exercised end-to-end locally:

```bash
bash scripts/val-foreground.sh
solana airdrop 100 -u http://localhost:8899
DEX=cpmm RPC_URL=http://localhost:8899 npm run launch
```
