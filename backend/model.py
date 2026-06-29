"""FunASR 模型加载与单例管理。

针对 N100（4C4T，无超线程，无 AVX-512）做了三件事：
  1. 进程启动时硬限 OMP/MKL/TORCH 线程，避免推理时超分掉速
  2. 开启 quantize=True 让 FunASR 走 onnxruntime + INT8，用上 N100 的 VNNI
  3. warmup 时跑一次真实推理，确保首请求不撞冷启动

模型加载策略：本地优先，回退 ModelScope
  - 若 MODEL_DIR / VAD_MODEL_DIR / PUNC_MODEL_DIR 存在且非空，直接用本地路径
  - 否则用 MODEL_NAME 等 repo_id，让 FunASR 从 ~/.cache/modelscope 加载/下载
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Optional, Union

from .config import (
    INTER_OP_THREADS,
    INTRA_OP_THREADS,
    MODEL_DEVICE,
    MODEL_DIR,
    MODEL_NAME,
    PUNC_MODEL,
    PUNC_MODEL_DIR,
    USE_QUANTIZE,
    VAD_MODEL,
    VAD_MODEL_DIR,
)

# ────────── 必须在 import torch/funasr/onnxruntime 之前设置 ──────────
# 一次性把线程数钉死。子进程（ffmpeg 等）会自己读自己环境，但 funasr 内部
# 的 torch / onnxruntime 也读这几个变量。
_THREAD_ENV_KEYS = (
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "TORCH_NUM_THREADS",
    "TORCH_CPU_NUM_THREADS",
    "NUMEXPR_NUM_THREADS",
)
for _k in _THREAD_ENV_KEYS:
    os.environ.setdefault(_k, str(INTRA_OP_THREADS))
os.environ.setdefault("OMP_WAIT_POLICY", "ACTIVE")
os.environ.setdefault("MALLOC_ARENA_MAX", "2")  # 减少 glibc 内存碎片

logger = logging.getLogger(__name__)

_model = None
_model_lock = threading.Lock()

# 各模型必需的最小文件清单（缺一不可；目录存在但文件不全视为"半残废"）
_REQUIRED_MODEL_FILES = {
    "ASR":  ["config.yaml", "model.pt", "tokens.json"],
    "VAD":  ["config.yaml", "model.pt", "am.mvn"],
    "PUNC": ["config.yaml", "model.pt"],
}


def _resolve_model(
    local_dir: Path,
    fallback_id: str,
    label: str,
    required_files: list[str],
) -> Union[str, Path]:
    """三级回退解析：

    1. 本地目录存在且**必需文件齐全** → 用本地路径（零网络）
    2. 目录缺失 / 空 / 文件不完整 → 警告并回退到 ModelScope repo_id
       （funasr 会自动从 ModelScope 拉取到 ~/.cache/modelscope）

    校验文件齐全比单纯 `any(dir.iterdir())` 更可靠：
      - 避免空目录陷阱（mkdir 后没下载就被当成"已就绪"）
      - 避免半残废目录（之前下载中断留下的 config 但缺 model.pt）
      - 自动触发重新下载修复
    """
    if local_dir.is_dir():
        present = {f.name for f in local_dir.iterdir() if f.is_file()}
        missing = [name for name in required_files if name not in present]
        if not missing:
            logger.info("%s 模型：本地目录就绪 %s", label, local_dir)
            return str(local_dir)
        # 目录存在但文件不全 —— 提示用户修复，避免 funasr 后续抛诡异异常
        logger.warning(
            "%s 模型：本地目录 %s 缺少必需文件 %s。建议修复："
            "rm -rf %s && python scripts/download_model.py --model %s",
            label, local_dir, missing, local_dir, label.lower(),
        )
    else:
        logger.info("%s 模型：本地目录不存在 %s", label, local_dir)
    logger.info("%s 模型：回退到 ModelScope repo_id %s", label, fallback_id)
    return fallback_id


def get_model():
    """惰性加载 + 全局单例，避免重复加载。"""
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:
            model_path = _resolve_model(
                MODEL_DIR, MODEL_NAME, "ASR", _REQUIRED_MODEL_FILES["ASR"],
            )
            vad_path = _resolve_model(
                VAD_MODEL_DIR, VAD_MODEL, "VAD", _REQUIRED_MODEL_FILES["VAD"],
            )
            punc_path = _resolve_model(
                PUNC_MODEL_DIR, PUNC_MODEL, "PUNC", _REQUIRED_MODEL_FILES["PUNC"],
            )

            logger.info(
                "正在加载模型 %s (device=%s, quantize=%s, threads=%d/%d)...",
                model_path, MODEL_DEVICE, USE_QUANTIZE, INTRA_OP_THREADS, INTER_OP_THREADS,
            )
            from funasr import AutoModel  # 首次导入较慢

            kwargs = dict(
                model=model_path,
                vad_model=vad_path,
                punc_model=punc_path,
                device=MODEL_DEVICE,
                disable_update=True,        # 锁版本，避免自动升级破坏缓存
                ncpu=INTRA_OP_THREADS,      # funasr 内部给 torch/onnx 传线程数
            )
            if USE_QUANTIZE:
                kwargs["quantize"] = True   # 走 onnxruntime + INT8（VNNI 加速）
            _model = AutoModel(**kwargs)
            logger.info("模型加载完成 ✓")
        return _model


def is_model_loaded() -> bool:
    """检查模型是否已就绪（不触发加载）。"""
    return _model is not None


def warmup() -> Optional[Exception]:
    """启动时预热模型：加载 + 跑一次真实推理，返回异常对象（如果有）。"""
    try:
        m = get_model()
        # 跑一次 1 秒静音，让 onnxruntime 完成算子编译、内存池分配
        # 这样首请求不会撞冷启动
        import numpy as np
        sr = 16000
        silence = np.zeros(sr, dtype=np.float32)
        logger.info("预热推理（1s 静音）...")
        m.generate(input=silence, use_itn=False, disable_pbar=True)
        logger.info("预热完成 ✓")
        return None
    except Exception as e:
        logger.exception("模型预热失败")
        return e
