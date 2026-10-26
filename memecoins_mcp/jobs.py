"""Async execution of the TypeScript runners (launch / lp-ops).

Each job runs ``npx ts-node --transpile-only <script>`` on a thread,
captures stdout line by line and extracts the final ``RESULT {json}``
line.
"""
import json
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path

from . import registry

ROOT = Path(__file__).resolve().parent.parent


def _spawn(kind: str, cmd: list[str], env: dict, meta: dict) -> dict:
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "kind": kind,
        "status": "running",
        "meta": meta,
        "log": [],
        "result": None,
        "createdAt": int(time.time()),
        "finishedAt": None,
    }
    registry.write_job(job)

    def run() -> None:
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT),
                env={**os.environ, **env},
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.rstrip()
                if line.startswith("RESULT "):
                    try:
                        job["result"] = json.loads(line[len("RESULT "):])
                    except Exception:
                        job["result"] = {"raw": line}
                else:
                    job["log"].append(line)
                registry.write_job(job)
            proc.wait()
            res = job["result"] or {}
            job["status"] = "failed" if proc.returncode != 0 or "error" in res else "done"
        except Exception as e:  # noqa: BLE001
            job["log"].append(f"runner error: {e}")
            job["status"] = "failed"
        job["finishedAt"] = int(time.time())
        registry.write_job(job)

    threading.Thread(target=run, daemon=True).start()
    return job


def start_launch(env: dict, meta: dict) -> dict:
    return _spawn(
        "launch",
        ["npx", "ts-node", "--transpile-only", "scripts/launch-dex.ts"],
        {**env, "LAUNCH_JSON": "1"},
        meta,
    )


def start_lp_op(op: str, pool_id: str, env: dict) -> dict:
    return _spawn(
        f"lp_{op}",
        ["npx", "ts-node", "--transpile-only", "scripts/lp-ops.ts", op, pool_id],
        env,
        {"op": op, "poolId": pool_id},
    )
