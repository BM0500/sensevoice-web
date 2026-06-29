"""识别核心逻辑。"""
from __future__ import annotations

import logging
import re
from typing import Callable, Optional

from .audio import extract_audio_from_video, is_video_file
from .model import get_model

logger = logging.getLogger(__name__)

_TAG_PATTERN = re.compile(r"<\s*\|\s*[A-Za-z0-9_ /\-]+\s*\|\s*>")
_WHITESPACE_PATTERN = re.compile(r"\s+")

# SenseVoice 支持的语种（funasr AutoModel.generate 的 language 参数）
# auto = 自动检测；其他 = 强制指定（适合气声/纯静音被误判为其他语种的场景）
SUPPORTED_LANGUAGES = {
    "auto": "自动检测",
    "zh": "中文",
    "en": "英文",
    "yue": "粤语",
    "ja": "日语",
    "ko": "韩语",
    "nospeech": "非语音",
}


def _strip_tags(text: str) -> str:
    """移除 SenseVoice 输出中的 <|tag|> 标记。"""
    if "<" in text and "|" in text and ">" in text:
        text = _TAG_PATTERN.sub(" ", text)
        text = _WHITESPACE_PATTERN.sub(" ", text)
    return text.strip()


def transcribe_file(file_path: str, language: str = "auto") -> str:
    """识别单个文件（音频或视频），返回纯文本。

    Args:
        file_path: 音频/视频文件路径
        language: 语种代码，参见 SUPPORTED_LANGUAGES。默认 "auto" 自动检测；
                  气声/背景噪音场景建议显式传 "zh"。
    """
    if language not in SUPPORTED_LANGUAGES:
        logger.warning("未知语种 %r，回退到 auto", language)
        language = "auto"

    cleanup_path: Optional[str] = None
    try:
        audio_path = file_path
        if is_video_file(file_path):
            audio_path = extract_audio_from_video(file_path)
            cleanup_path = audio_path

        model = get_model()
        result = model.generate(input=audio_path, language=language)[0]
        text = result.get("text", "")
        return _strip_tags(text)
    except Exception as e:
        logger.exception("识别失败: %s", file_path)
        raise RuntimeError(str(e)) from e
    finally:
        if cleanup_path:
            try:
                import os
                if os.path.exists(cleanup_path):
                    os.unlink(cleanup_path)
            except OSError:
                pass
