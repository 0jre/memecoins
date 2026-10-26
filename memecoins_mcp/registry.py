"""JSON registry of launched tokens and operation jobs.

Persists to ``data/registry.json`` (gitignored) — same format as the old
dashboard for compatibility.
"""
import json
import os
import threading
import time
from pathlib import Path

_ROOT = Path(os.environ.get("MEMECOINS_HOME", Path(__file__).resolve().parent.parent))
DATA_DIR = _ROOT / "data"
REGISTRY_FILE = DATA_DIR / "registry.json"
JOBS_DIR = DATA_DIR / "jobs"

_lock = threading.Lock()


def _read() -> dict:
    try:
        return json.loads(REGISTRY_FILE.read_text())
    except Exception:
        return {"tokens": [], "ops": []}


def _write(store: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = REGISTRY_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, indent=2, ensure_ascii=False))
    tmp.replace(REGISTRY_FILE)


def list_tokens() -> list[dict]:
    return _read()["tokens"]


def get_token(mint: str) -> dict | None:
    return next((t for t in _read()["tokens"] if t["mint"] == mint), None)


def add_token(rec: dict) -> None:
    with _lock:
        s = _read()
        rec.setdefault("createdAt", int(time.time()))
        s["tokens"] = [t for t in s["tokens"] if t["mint"] != rec["mint"]] + [rec]
        _write(s)


def list_ops() -> list[dict]:
    return _read()["ops"]


def add_op(rec: dict) -> None:
    with _lock:
        s = _read()
        rec.setdefault("ts", int(time.time()))
        s["ops"].append(rec)
        _write(s)


def job_path(job_id: str) -> Path:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    return JOBS_DIR / f"{job_id}.json"


def write_job(job: dict) -> None:
    job_path(job["id"]).write_text(json.dumps(job, indent=2, ensure_ascii=False))


def read_job(job_id: str) -> dict | None:
    p = job_path(job_id)
    if not p.exists():
        return None
    return json.loads(p.read_text())


def list_jobs() -> list[dict]:
    if not JOBS_DIR.exists():
        return []
    jobs = []
    for f in sorted(JOBS_DIR.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
        try:
            jobs.append(json.loads(f.read_text()))
        except Exception:
            continue
    return jobs
