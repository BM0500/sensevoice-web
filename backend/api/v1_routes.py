"""OpenAI 兼容端点：POST /v1/audio/transcriptions

设计目标：让任何支持 OpenAI SDK 的 AI agent / 工具 / 服务能直接调，
不需要写轮询循环。同步返回结果。

与现有 /api/* 异步端点的区别：
  - /api/transcribe       异步：返回 job_id，前端轮询
  - /v1/audio/transcriptions 同步：阻塞到识别完，返回纯文本

支持的 response_format（与 OpenAI 对齐）：
  - json   默认，返回 {"text": "..."}
  - text   返回纯文本
  - srt    单段 SRT 字幕（SenseVoice 不带时间戳，全段视为一句）
  - vtt    单段 WebVTT

如果以后需要多段时间戳，可开启 funasr 的 return_timestamp=True，
这里再加分段逻辑。
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

from ..audio import extract_audio_from_video, is_video_file
from ..config import ALLOWED_EXTS, MAX_UPLOAD_SIZE_BYTES, SINGLE_FLIGHT, TEMP_DIR
from ..transcriber import SUPPORTED_LANGUAGES, transcribe_file

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/v1")

# ────────────────────────── 单飞（与 /api/transcribe 共享语义） ──────────────────────────
# 简单计数器 + 锁：SINGLE_FLIGHT=true 时阻塞等待直到空闲
_active = 0
_active_lock = threading.Lock()
_active_cond = threading.Condition(_active_lock)


def _enter() -> None:
    global _active
    with _active_cond:
        # 等到没人占用
        while _active > 0:
            _active_cond.wait(timeout=1)
        _active += 1


def _exit() -> None:
    global _active
    with _active_cond:
        _active = max(0, _active - 1)
        if _active == 0:
            _active_cond.notify_all()


# ────────────────────────── 端点 ──────────────────────────
@router.post("/audio/transcriptions")
async def create_transcription(
    file: UploadFile = File(..., description="音频/视频文件"),
    model: str = Form("sensevoice", description="OpenAI 兼容字段，本项目固定为 sensevoice"),
    language: str = Form("auto", description=f"语种，可选: {', '.join(SUPPORTED_LANGUAGES)}"),
    response_format: str = Form("json", description="json | text | srt | vtt"),
):
    """OpenAI 兼容的同步语音识别端点。

    注意：SINGLE_FLIGHT=true 时排队等待；其他识别任务完成后再处理。
    """
    # ── 参数校验 ──
    if not file.filename:
        raise HTTPException(400, "未提供文件")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f"不支持的文件类型: {file.filename}")
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(400, f"不支持的语种: {language}")
    if response_format not in ("json", "text", "srt", "vtt"):
        raise HTTPException(
            400, f"不支持的 response_format: {response_format}（支持: json, text, srt, vtt）"
        )

    # ── 读取文件（限大小） ──
    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            413,
            f"文件 {len(content) // 1024 // 1024}MB 超过 {MAX_UPLOAD_SIZE_BYTES // 1024 // 1024}MB 限制",
        )

    # ── 单飞：等待空闲 ──
    if SINGLE_FLIGHT:
        _enter()
    else:
        # 不强制单飞，但记日志
        logger.info("v1/audio: 单飞关闭，并行处理")

    # ── 保存到临时目录 ──
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = f"{int(time.time() * 1000)}_{Path(file.filename).name}"
    save_path = TEMP_DIR / safe_name
    save_path.write_bytes(content)
    cleanup_path: str | None = None

    try:
        # 视频先抽音轨
        audio_path = str(save_path)
        if is_video_file(file.filename):
            audio_path = extract_audio_from_video(str(save_path))
            cleanup_path = audio_path

        # 同步识别
        logger.info(
            "v1/audio: 识别 %s (language=%s, format=%s)",
            file.filename, language, response_format,
        )
        text = transcribe_file(audio_path, language=language)

        # ── 按 response_format 返回 ──
        if response_format == "text":
            return PlainTextResponse(content=text, media_type="text/plain; charset=utf-8")

        if response_format == "srt":
            # SenseVoice 不返回时间戳，单段视为整段（标注 approximate duration）
            # 实际字幕场景建议后续加 return_timestamp=True
            srt = f"1\n00:00:00,000 --> 00:59:59,999\n{text}\n"
            return PlainTextResponse(
                content=srt,
                media_type="application/x-subrip; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{Path(file.filename).stem}.srt"'},
            )

        if response_format == "vtt":
            vtt = f"WEBVTT\n\n00:00:00.000 --> 00:59:59.999\n{text}\n"
            return PlainTextResponse(
                content=vtt,
                media_type="text/vtt; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{Path(file.filename).stem}.vtt"'},
            )

        # default: json（OpenAI 标准）
        return JSONResponse(content={"text": text})

    finally:
        # 清理临时文件
        for p in (str(save_path), cleanup_path):
            if not p:
                continue
            try:
                if os.path.exists(p):
                    os.unlink(p)
            except OSError:
                pass
        if SINGLE_FLIGHT:
            _exit()


@router.get("/models")
async def list_models() -> dict:
    """OpenAI 兼容：列出可用模型（虽然只有一个）。"""
    return {
        "object": "list",
        "data": [
            {
                "id": "sensevoice",
                "object": "model",
                "created": 1700000000,
                "owned_by": "local",
                "permission": [],
            }
        ],
    }