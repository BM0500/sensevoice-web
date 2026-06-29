"""FastAPI 路由：上传、查询、导出、健康检查。"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from .. import jobs as job_store
from ..config import (
    ALLOWED_EXTS,
    JOB_TTL_SECONDS,
    MAX_FILES_PER_JOB,
    MAX_UPLOAD_SIZE_BYTES,
    SINGLE_FLIGHT,
    TEMP_DIR,
)
from ..jobs import Job, is_terminal, run_job
from ..model import is_model_loaded
from ..transcriber import SUPPORTED_LANGUAGES

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

# ────────────────────────── 单飞计数器（N100 4C4T 限制并发） ──────────────────────────
# 简单计数比 list_jobs() 遍历更便宜；线程安全靠 Lock 保护。
_active_jobs = 0
_active_jobs_lock = threading.Lock()


def _is_busy() -> bool:
    if not SINGLE_FLIGHT:
        return False
    with _active_jobs_lock:
        return _active_jobs > 0


def _enter_job() -> None:
    with _active_jobs_lock:
        global _active_jobs
        _active_jobs += 1


def _exit_job() -> None:
    with _active_jobs_lock:
        global _active_jobs
        _active_jobs = max(0, _active_jobs - 1)


# ────────────────────────── 健康检查 ──────────────────────────
@router.get("/health")
def health() -> dict:
    """供 NAS 容器管理器探活。"""
    return {"status": "ok", "ts": int(time.time())}


# ────────────────────────── 模型状态 ──────────────────────────
@router.get("/status")
def status() -> dict:
    """返回模型就绪状态。"""
    return {
        "model_loaded": is_model_loaded(),
        "active_jobs": len([j for j in job_store.list_jobs() if j.status == "processing"]),
    }


# ────────────────────────── 上传并创建任务 ──────────────────────────
@router.post("/transcribe")
async def transcribe(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    language: str = Form("auto"),
) -> dict:
    if not files:
        raise HTTPException(400, "未提供文件")
    if len(files) > MAX_FILES_PER_JOB:
        raise HTTPException(400, f"单次最多 {MAX_FILES_PER_JOB} 个文件")
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(400, f"不支持的语种: {language}（支持: {', '.join(SUPPORTED_LANGUAGES)}）")

    # 单飞：N100 上同时只跑一个识别任务
    if _is_busy():
        raise HTTPException(429, "已有识别任务在进行中，请稍后再试")

    # 校验扩展名 + 保存到临时目录
    saved_paths: list[str] = []
    saved_names: list[str] = []
    total_size = 0
    for f in files:
        name = f.filename or "unknown"
        ext = Path(name).suffix.lower()
        if ext not in ALLOWED_EXTS:
            raise HTTPException(400, f"不支持的文件类型: {name}")

        # 流式读取，限制大小
        content = await f.read()
        total_size += len(content)
        if total_size > MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(413, f"总大小超过 {MAX_UPLOAD_SIZE_BYTES // 1024 // 1024}MB 限制")

        # 保存到临时文件
        safe_name = f"{int(time.time() * 1000)}_{Path(name).name}"
        save_path = TEMP_DIR / safe_name
        save_path.parent.mkdir(parents=True, exist_ok=True)
        save_path.write_bytes(content)
        saved_paths.append(str(save_path))
        saved_names.append(name)

    # 创建任务
    job = job_store.create_job(saved_names, language=language)

    # 后台异步执行（用 _enter_job/_exit_job 维护单飞计数）
    background_tasks.add_task(_run_with_cleanup, job.id, saved_paths, language)

    logger.info("创建任务 %s: %d 个文件, 语种=%s", job.id, len(saved_names), language)
    return {
        "job_id": job.id,
        "total": job.total,
        "language": language,
        "files": [{"name": f.name, "status": f.status} for f in job.files],
    }


def _run_with_cleanup(job_id: str, file_paths: list[str], language: str) -> None:
    """包装函数：识别完成后清理临时文件 + 维护单飞计数。"""
    _enter_job()
    try:
        run_job(job_id, file_paths, language=language)
    finally:
        for p in file_paths:
            try:
                if os.path.exists(p):
                    os.unlink(p)
            except OSError:
                pass
        _exit_job()


# ────────────────────────── 查询任务状态 ──────────────────────────
@router.get("/jobs/{job_id}")
def get_job_status(job_id: str) -> dict:
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在或已过期")
    return _job_to_dict(job)


def _job_to_dict(job: Job) -> dict:
    return {
        "id": job.id,
        "status": job.status,
        "total": job.total,
        "done": job.done,
        "language": job.language,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "files": [
            {
                "name": f.name,
                "status": f.status,
                "text": f.text,
                "error": f.error,
            }
            for f in job.files
        ],
        "error": job.error,
    }


# ────────────────────────── 列出已结束任务 ──────────────────────────
@router.get("/jobs")
def list_finished_jobs(limit: int = 50) -> dict:
    """返回已结束（completed/failed）的任务列表，按 updated_at 倒序。

    活跃任务不暴露，避免历史面板与主界面状态错乱。
    """
    finished = [j for j in job_store.list_jobs() if is_terminal(j.status)]
    finished.sort(key=lambda j: j.updated_at, reverse=True)
    finished = finished[: max(1, min(limit, 200))]
    return {"jobs": [_job_to_dict(j) for j in finished], "total": len(finished)}


# ────────────────────────── 删除任务 ──────────────────────────
@router.delete("/jobs/{job_id}")
def delete_job(job_id: str) -> dict:
    """删除已结束的任务。活跃任务返回 409。"""
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在或已过期")
    if not is_terminal(job.status):
        raise HTTPException(409, f"任务进行中，无法删除（状态：{job.status}）")
    job_store.delete_job(job_id)
    return {"deleted": job_id}


# ────────────────────────── 导出 TXT ──────────────────────────
@router.get("/jobs/{job_id}/export", response_class=PlainTextResponse)
def export_job(job_id: str) -> str:
    job = job_store.get_job(job_id)
    if job is None:
        raise HTTPException(404, "任务不存在或已过期")

    lines = [
        f"语音识别结果 - {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"任务 ID: {job.id}",
        "=" * 50,
    ]
    for f in job.files:
        status_icon = {
            "completed": "✅",
            "failed": "❌",
            "pending": "⏸️",
            "processing": "⏳",
        }.get(f.status, "•")
        lines.append(f"\n{status_icon} {f.name} [{f.status}]")
        if f.status == "completed":
            lines.append(f"   {f.text}")
        elif f.status == "failed":
            lines.append(f"   错误: {f.error}")
    return "\n".join(lines)


# ────────────────────────── 周期清理（导入时启动） ──────────────────────────
_cleanup_thread_started = False


def start_cleanup_thread() -> None:
    global _cleanup_thread_started
    if _cleanup_thread_started:
        return
    _cleanup_thread_started = True

    def _loop():
        while True:
            try:
                removed = job_store.cleanup_expired(JOB_TTL_SECONDS)
                if removed:
                    logger.info("清理了 %d 个过期任务", removed)
            except Exception:
                logger.exception("清理任务异常")
            time.sleep(300)  # 每 5 分钟

    t = threading.Thread(target=_loop, daemon=True, name="job-cleanup")
    t.start()
