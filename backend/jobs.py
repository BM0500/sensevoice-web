"""任务管理器：内存中跟踪识别任务状态。"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

from .transcriber import transcribe_file

# ────────────────────────── 数据模型 ──────────────────────────
@dataclass
class FileResult:
    name: str
    status: str = "pending"  # pending | processing | completed | failed
    text: str = ""
    error: str = ""


@dataclass
class Job:
    id: str
    total: int
    done: int = 0
    status: str = "queued"  # queued | processing | completed | failed
    files: list[FileResult] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    error: str = ""
    language: str = "auto"  # 语种：auto / zh / en / yue / ja / ko


_TERMINAL_STATUSES = {"completed", "failed"}


def is_terminal(status: str) -> bool:
    """任务是否已结束（completed/failed）。"""
    return status in _TERMINAL_STATUSES


# ────────────────────────── 任务存储 ──────────────────────────
_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()


def create_job(file_names: list[str], language: str = "auto") -> Job:
    job = Job(
        id=uuid.uuid4().hex,
        total=len(file_names),
        language=language,
        files=[FileResult(name=n) for n in file_names],
    )
    with _jobs_lock:
        _jobs[job.id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    with _jobs_lock:
        return _jobs.get(job_id)


def list_jobs() -> list[Job]:
    with _jobs_lock:
        return list(_jobs.values())


def delete_job(job_id: str) -> bool:
    """删除任务。活跃任务（queued/processing）拒绝删除，返回 False。"""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            return False
        if not is_terminal(job.status):
            return False
        _jobs.pop(job_id, None)
        return True


def cleanup_expired(ttl_seconds: int) -> int:
    """清理过期任务，返回清理数量。

    只清理**已结束**（completed/failed）的任务，避免误清仍在处理中的长任务。
    活跃任务（queued/processing）由更高级别的监控负责（如卡死检测）。
    """
    cutoff = time.time() - ttl_seconds
    with _jobs_lock:
        expired = [
            jid
            for jid, job in _jobs.items()
            if job.status in _TERMINAL_STATUSES and job.updated_at < cutoff
        ]
        for jid in expired:
            _jobs.pop(jid, None)
    return len(expired)


# ────────────────────────── 任务执行 ──────────────────────────
def run_job(
    job_id: str,
    file_paths: list[str],
    language: str = "auto",
    on_file_done: Optional[Callable[[Job, int], None]] = None,
) -> None:
    """同步执行识别任务，逐文件更新状态。"""
    job = get_job(job_id)
    if job is None:
        return

    job.status = "processing"
    job.updated_at = time.time()
    try:
        for idx, path in enumerate(file_paths):
            job.files[idx].status = "processing"
            job.updated_at = time.time()
            try:
                text = transcribe_file(path, language=language)
                job.files[idx].text = text
                job.files[idx].status = "completed"
            except Exception as e:
                job.files[idx].error = str(e)
                job.files[idx].status = "failed"
            finally:
                job.done = idx + 1
                job.updated_at = time.time()
                if on_file_done:
                    on_file_done(job, idx)
        job.status = "completed"
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
    finally:
        job.updated_at = time.time()