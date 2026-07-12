import datetime
import threading
import uuid
from typing import Any, Dict, List

from .action_executor import execute_action_task, execute_action_unit


_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_lock = threading.Lock()
_MAX_JOBS = 100


def _now() -> str:
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _snapshot(job: Dict[str, Any]) -> Dict[str, Any]:
    return dict(job)


def _prune_locked() -> None:
    if len(_jobs) <= _MAX_JOBS:
        return
    finished = [
        item for item in _jobs.values()
        if item.get("status") not in ("queued", "running")
    ]
    finished.sort(key=lambda item: str(item.get("finished_at") or item.get("started_at") or ""))
    for item in finished[:max(0, len(_jobs) - _MAX_JOBS)]:
        _jobs.pop(str(item.get("job_id")), None)


def _run_job(job_id: str) -> None:
    with _jobs_lock:
        job = _jobs[job_id]
        job["status"] = "running"
        job["started_at"] = _now()

    try:
        if job["kind"] == "action_unit":
            result = execute_action_unit(job["target_id"], source=job["source"], dry_run=job["dry_run"])
        elif job["kind"] == "task":
            result = execute_action_task(job["target_id"], source=job["source"], dry_run=job["dry_run"])
        else:
            raise RuntimeError(f"unsupported action job kind: {job['kind']}")
        status = str(result.get("status") or ("success" if result.get("ok") else "failed"))
        message = str(result.get("message") or status)
    except Exception as exc:
        result = {"ok": False, "status": "failed", "message": str(exc)}
        status = "failed"
        message = str(exc)

    with _jobs_lock:
        job = _jobs[job_id]
        job["status"] = status
        job["message"] = message
        job["finished_at"] = _now()
        job["result"] = result
        _prune_locked()


def start_action_job(kind: str, target_id: str, source: str, dry_run: bool) -> Dict[str, Any]:
    job_id = uuid.uuid4().hex[:12]
    job = {
        "ok": True,
        "job_id": job_id,
        "kind": kind,
        "target_id": target_id,
        "source": source,
        "dry_run": bool(dry_run),
        "status": "queued",
        "message": "Action accepted and running in background",
        "created_at": _now(),
        "started_at": None,
        "finished_at": None,
        "result": None,
    }
    with _jobs_lock:
        _jobs[job_id] = job
        _prune_locked()

    thread = threading.Thread(target=_run_job, args=(job_id,), daemon=True, name=f"ActionJob-{job_id}")
    thread.start()

    with _jobs_lock:
        return _snapshot(_jobs[job_id])


def get_action_job(job_id: str) -> Dict[str, Any]:
    with _jobs_lock:
        if job_id not in _jobs:
            raise FileNotFoundError(f"action job not found: {job_id}")
        return _snapshot(_jobs[job_id])


def list_action_jobs(limit: int = 50) -> List[Dict[str, Any]]:
    limit = max(1, min(int(limit), 100))
    with _jobs_lock:
        items = [_snapshot(item) for item in _jobs.values()]
    items.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return items[:limit]
