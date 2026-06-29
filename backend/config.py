"""应用配置与常量。"""
from __future__ import annotations

import os
from pathlib import Path

# ────────────────────────── 文件类型 ──────────────────────────
AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".wma"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v"}
ALLOWED_EXTS = sorted(AUDIO_EXTS | VIDEO_EXTS)

# ────────────────────────── 上传限制 ──────────────────────────
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "500"))
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024
MAX_FILES_PER_JOB = int(os.getenv("MAX_FILES_PER_JOB", "20"))

# ────────────────────────── 模型配置 ──────────────────────────
# ModelScope repo_id（当本地目录不存在时兜底使用）
MODEL_NAME = os.getenv("MODEL_NAME", "iic/SenseVoiceSmall")
VAD_MODEL = os.getenv("VAD_MODEL", "fsmn-vad")
PUNC_MODEL = os.getenv("PUNC_MODEL", "ct-punc")
MODEL_DEVICE = os.getenv("MODEL_DEVICE", "cpu")  # NAS 无 GPU，强制 CPU

# 本地模型目录（指向 ./data/models/ 下已离线下载的目录）
# 留空 → 自动回退到上面的 ModelScope repo_id，从 ~/.cache/modelscope 加载/下载
_DEFAULT_MODELS_ROOT = "/app/models" if os.path.isdir("/app") else str(
    Path(__file__).resolve().parent.parent / "data" / "models"
)
MODEL_DIR = Path(os.getenv("MODEL_DIR", f"{_DEFAULT_MODELS_ROOT}/sensevoice"))
VAD_MODEL_DIR = Path(os.getenv("VAD_MODEL_DIR", f"{_DEFAULT_MODELS_ROOT}/vad"))
PUNC_MODEL_DIR = Path(os.getenv("PUNC_MODEL_DIR", f"{_DEFAULT_MODELS_ROOT}/punc"))

# ────────────────────────── 临时文件目录 ──────────────────────────
TEMP_DIR = Path(os.getenv("TEMP_DIR", "/tmp/sensevoice"))
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# ────────────────────────── 任务清理 ──────────────────────────
JOB_TTL_SECONDS = int(os.getenv("JOB_TTL_SECONDS", "3600"))  # 任务保留 1 小时

# ────────────────────────── 推理优化（N100 4C4T 调优） ──────────────────────────
# 开启 ONNX int8 量化推理（FunASR 内部走 onnxruntime，会用上 N100 的 VNNI 指令）
USE_QUANTIZE = os.getenv("USE_QUANTIZE", "true").lower() in ("1", "true", "yes")

# 进程内并发线程数：N100 4C4T，给系统/ffmpeg 留 1 核，推理最多 3 线程
INTRA_OP_THREADS = int(os.getenv("INTRA_OP_THREADS", "3"))
INTER_OP_THREADS = int(os.getenv("INTER_OP_THREADS", "1"))

# ffmpeg 解码线程：抽 16kHz 单声道用 1 线程足够
FFMPEG_THREADS = int(os.getenv("FFMPEG_THREADS", "1"))

# 单飞模式：N100 上同时只能跑一个识别任务，避免多任务抢占 4 核
SINGLE_FLIGHT = os.getenv("SINGLE_FLIGHT", "true").lower() in ("1", "true", "yes")
