"""音频/视频处理：ffmpeg 抽音轨。"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from .config import FFMPEG_THREADS, TEMP_DIR, VIDEO_EXTS


def is_video_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in VIDEO_EXTS


def extract_audio_from_video(video_path: str) -> str:
    """用 ffmpeg 从视频中提取 16kHz 单声道 WAV，返回临时文件路径。

    N100 调优：
      - `-threads 1` 解 16kHz 音频单线程足够，省 1 核给 ASR
      - 临时文件落到 TEMP_DIR（持久化卷）而非 /tmp，避免 tmpfs 容量/重启丢失
    """
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False, dir=str(TEMP_DIR))
    tmp_path = tmp.name
    tmp.close()
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-threads", str(FFMPEG_THREADS),
                "-i", video_path,
                "-vn",
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                tmp_path,
            ],
            capture_output=True,
            timeout=600,
            check=True,
        )
        return tmp_path
    except subprocess.CalledProcessError as e:
        _safe_unlink(tmp_path)
        err = e.stderr.decode(errors="replace")[:300] if e.stderr else str(e)
        raise RuntimeError(f"ffmpeg 提取音频失败: {err}") from e
    except Exception:
        _safe_unlink(tmp_path)
        raise


def _safe_unlink(path: str | None) -> None:
    if path and os.path.exists(path):
        try:
            os.unlink(path)
        except OSError:
            pass
