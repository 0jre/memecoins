"""MCP server — Solana memecoin creation for AI agents.

Run with:  memecoins-mcp  (stdio)  or  python -m memecoins_mcp.server

On-chain operations are executed by the TypeScript runners in
``scripts/`` (official Raydium/Orca/Meteora SDKs). This server is pure
orchestration, jobs and registry logic — no user interface.
"""
import json
import os
import threading
import time
import urllib.request
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from . import jobs, registry

mcp = FastMCP(
    "memecoins",
    instructions=(
        "Launch SPL memecoins on Solana straight onto a DEX "
        "(Raydium CPMM/CLMM, Meteora DLMM/DBC, Orca Whirlpool). "
        "Use launch_memecoin to start an async launch and get_job "
        "to track it. Tokens: 1B supply, 6 decimals, immutable "
        "metadata, mint+freeze authorities revoked."
    ),
)

VENUES = {
    "cpmm": {
        "venue": "Raydium CPMM",
        "pool": "constant product",
        "lp_modes": ["burn", "keep", "lock"],
    },
    "clmm": {
        "venue": "Raydium CLMM",
        "pool": "concentrated (full-range)",
        "lp_modes": ["burn", "keep", "lock"],
    },
    "dlmm": {
        "venue": "Meteora DLMM",
        "pool": "bins",
        "lp_modes": ["keep"],
    },
    "whirlpool": {
        "venue": "Orca Whirlpool",
        "pool": "concentrated (full-range)",
        "lp_modes": ["burn", "keep"],
    },
    "dbc": {
        "venue": "Meteora Dynamic Bonding Curve",
        "pool": "virtual curve → DAMM V2 migration (pump.fun model, no initial liquidity)",
        "lp_modes": ["keep", "lock", "burn"],
    },
}

_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58encode(raw: bytes) -> str:
    n = int.from_bytes(raw, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = _B58[r] + out
    pad = len(raw) - len(raw.lstrip(b"\0"))
    return _B58[0] * pad + out


def _payer_path() -> Path:
    return Path(
        os.environ.get(
            "PAYER", str(Path.home() / ".config" / "solana" / "id.json")
        )
    ).expanduser()


def _payer_pubkey() -> str:
    secret = json.loads(_payer_path().read_text())
    return _b58encode(bytes(secret[32:]))


def _cluster() -> tuple[str, str]:
    c = (os.environ.get("CLUSTER") or "devnet").lower()
    rpc = os.environ.get("RPC_URL")
    if rpc:
        return (rpc, "mainnet" if "main" in c else "devnet")
    if c in ("mainnet", "mainnet-beta"):
        return ("https://api.mainnet-beta.solana.com", "mainnet")
    return ("https://api.devnet.solana.com", "devnet")


def _rpc_call(method: str, params: list) -> dict:
    rpc, _ = _cluster()
    req = urllib.request.Request(
        rpc,
        data=json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        ).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


@mcp.tool()
def get_config() -> dict:
    """Current configuration: available venues, cluster, payer and required env vars."""
    rpc, cluster = _cluster()
    payer = None
    payer_err = None
    try:
        payer = _payer_pubkey()
    except Exception as e:  # noqa: BLE001
        payer_err = str(e)
    return {
        "cluster": cluster,
        "rpc": rpc,
        "payer_pubkey": payer,
        "payer_error": payer_err,
        "venues": VENUES,
        "env_vars": [
            "CLUSTER (devnet|mainnet-beta)",
            "RPC_URL (optional, overrides the public endpoint)",
            "PAYER (path to the keypair JSON; default ~/.config/solana/id.json)",
            "TEAM_WALLET (receives TEAM_BPS of the supply)",
            "CONFIRM_MAINNET=YES (required for mainnet)",
        ],
    }


@mcp.tool()
def preflight(liq_sol: float = 1.0) -> dict:
    """Preflight check: payer balance vs estimated launch cost.

    liq_sol only matters for venues with initial liquidity (dbc needs none).
    """
    rpc, cluster = _cluster()
    try:
        pub = _payer_pubkey()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"payer not loaded: {e}"}
    try:
        res = _rpc_call("getBalance", [pub])
        lamports = res["result"]["value"]
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"RPC failed ({rpc}): {e}"}
    required = liq_sol + 0.2
    sol = lamports / 1e9
    return {
        "ok": sol >= required,
        "cluster": cluster,
        "payer": pub,
        "balance_sol": round(sol, 4),
        "required_sol": round(required, 4),
        "note": "liquidity + ~0.2 SOL fees/rent; DBC needs no initial liquidity",
    }


@mcp.tool()
def launch_memecoin(
    name: str,
    symbol: str,
    uri: str = "",
    dex: str = "cpmm",
    lp_mode: str = "burn",
    liq_sol: float = 1.0,
    team_wallet: str = "",
    team_bps: int = 1800,
    confirm_mainnet: bool = False,
) -> dict:
    """Start an async memecoin launch. Returns a job_id.

    - name/symbol/uri: token metadata (Metaplex URI — JSON with image)
    - dex: cpmm | clmm | dlmm | whirlpool | dbc
    - lp_mode: burn | keep | lock (see get_config for per-venue support)
    - liq_sol: initial liquidity in SOL (ignored for dbc — liquidity-free curve)
    - team_wallet: wallet receiving team_bps of supply (default: env TEAM_WALLET)
    - team_bps: 0–10000 (1800 = 18%)
    - confirm_mainnet: must be True when CLUSTER=mainnet-beta
    """
    dex = dex.lower()
    lp_mode = lp_mode.lower()
    if dex not in VENUES:
        return {"error": f"invalid dex: {dex}. Options: {list(VENUES)}"}
    if lp_mode not in VENUES[dex]["lp_modes"]:
        return {
            "error": f"lp_mode '{lp_mode}' not supported on {dex}. "
            f"Options: {VENUES[dex]['lp_modes']}"
        }
    if not 0 <= team_bps <= 10000:
        return {"error": "team_bps out of range 0–10000"}
    _, cluster = _cluster()
    if cluster == "mainnet" and not confirm_mainnet:
        return {
            "error": "mainnet launch refused: call with confirm_mainnet=True "
            "(spends real SOL and creates an irreversible on-chain token)"
        }

    env = {}
    if team_wallet:
        env["TEAM_WALLET"] = team_wallet
    if confirm_mainnet:
        env["CONFIRM_MAINNET"] = "YES"
    env.update(
        {
            "NAME": name,
            "SYMBOL": symbol,
            "URI": uri,
            "DEX": dex,
            "LP_MODE": lp_mode,
            "LIQ_SOL": str(liq_sol),
            "TEAM_BPS": str(team_bps),
        }
    )
    job = jobs.start_launch(
        env, {"name": name, "symbol": symbol, "dex": dex, "lpMode": lp_mode}
    )

    def _on_done() -> None:
        # register the token in the registry once the job finishes
        while job["status"] == "running":
            time.sleep(2)
        res = job.get("result") or {}
        if job["status"] == "done" and res.get("mint"):
            registry.add_token(
                {
                    "mint": res["mint"],
                    "name": name,
                    "symbol": symbol,
                    "uri": uri,
                    "teamAta": res.get("teamAta", ""),
                    "teamWallet": res.get("teamAta", ""),
                    "teamBps": team_bps,
                    "dex": res.get("dex", dex),
                    "poolId": res.get("poolId", ""),
                    "lpMode": lp_mode,
                    "lpAction": res.get("lpAction", ""),
                    "txIds": res.get("txIds", []),
                    "cluster": res.get("cluster", cluster),
                }
            )

    threading.Thread(target=_on_done, daemon=True).start()
    return {
        "job_id": job["id"],
        "status": "running",
        "note": "track with get_job(job_id); the token is registered automatically on completion",
    }


@mcp.tool()
def get_job(job_id: str) -> dict:
    """Status, log and result of a job (launch or lp op)."""
    job = registry.read_job(job_id)
    if not job:
        return {"error": f"job not found: {job_id}"}
    return job


@mcp.tool()
def list_jobs() -> list[dict]:
    """All jobs, newest first."""
    return registry.list_jobs()


@mcp.tool()
def list_launches() -> list[dict]:
    """Launched tokens registered locally."""
    return registry.list_tokens()


@mcp.tool()
def get_token(mint: str) -> dict:
    """Details of a launched token by mint."""
    t = registry.get_token(mint)
    return t or {"error": f"token not registered: {mint}"}


@mcp.tool()
def burn_cpmm_lp(pool_id: str) -> dict:
    """Burn all CPMM LP tokens of the pool held by the payer wallet (async)."""
    job = jobs.start_lp_op("burn", pool_id, {})
    return {"job_id": job["id"], "status": "running"}


@mcp.tool()
def lock_cpmm_lp(pool_id: str) -> dict:
    """Lock all CPMM LP tokens via Raydium CpLock (async)."""
    job = jobs.start_lp_op("lock", pool_id, {})
    return {"job_id": job["id"], "status": "running"}


@mcp.prompt()
def launch_guide() -> str:
    """Step-by-step launch guide for the agent."""
    return (
        "To launch a memecoin:\n"
        "1. get_config — confirm cluster, payer and venues\n"
        "2. preflight(liq_sol) — validate the payer balance\n"
        "3. launch_memecoin(name, symbol, uri, dex, lp_mode, liq_sol, "
        "team_wallet, team_bps) — start the job\n"
        "4. get_job(job_id) until status=done — grab mint/poolId/links\n"
        "Venue 'dbc' = pump.fun model (zero initial liquidity).\n"
        "Mainnet requires confirm_mainnet=True."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
