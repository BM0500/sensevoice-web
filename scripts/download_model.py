#!/usr/bin/env python3
"""下载 SenseVoice / VAD / 标点模型到 ./data/models/，避免每次启动重新下载。

用法：
    python scripts/download_model.py                # 下载全部
    python scripts/download_model.py --model vad    # 仅 VAD
    python scripts/download_model.py --model sensevoice vad

环境变量（可选，覆盖默认 repo_id）：
    SENSEVOICE_REPO / VAD_REPO / PUNC_REPO
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL_DIR = ROOT / "data" / "models"

# 默认 ModelScope repo_id，可在环境变量里覆盖
DEFAULT_MODELS = {
    "sensevoice": os.getenv("SENSEVOICE_REPO", "iic/SenseVoiceSmall"),
    "vad": os.getenv("VAD_REPO", "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"),
    "punc": os.getenv("PUNC_REPO", "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch"),
}


def _import_modelscope():
    try:
        from modelscope import snapshot_download  # noqa: WPS433
    except ImportError:
        print(
            "❌ 缺少 modelscope 依赖。\n"
            "   请在 venv 中运行：pip install 'modelscope>=1.10.0'\n"
            "   或在宿主机直接：pip install --user 'modelscope>=1.10.0'",
            file=sys.stderr,
        )
        sys.exit(2)
    return snapshot_download


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} TB"


def _dir_size(p: Path) -> int:
    total = 0
    for f in p.rglob("*"):
        if f.is_file():
            total += f.stat().st_size
    return total


def _move_contents(src: Path, dst: Path) -> None:
    """把 src 下的所有项移到 dst，保持扁平。"""
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()
        shutil.move(str(item), str(target))


def download_one(name: str, repo_id: str, target: Path) -> Path:
    """下载单个模型到 target，返回 target。"""
    if target.exists() and any(target.iterdir()):
        print(f"⏭️  {name}: 已存在 {target} ({_human_size(_dir_size(target))})，跳过")
        return target

    snapshot_download = _import_modelscope()
    target.parent.mkdir(parents=True, exist_ok=True)

    # modelscope 默认会建 hub/<org>/<repo>/ 中间层，先下到临时位置再搬
    tmp_cache = target.parent / f".cache_{name}"
    if tmp_cache.exists():
        shutil.rmtree(tmp_cache)

    print(f"📥 {name}: 正在下载 {repo_id}")
    try:
        snapshot_dir = Path(
            snapshot_download(
                repo_id,
                cache_dir=str(tmp_cache),
                revision="master",
            )
        )
    except Exception:
        shutil.rmtree(tmp_cache, ignore_errors=True)
        raise

    # modelscope 可能在 tmp_cache/hub/<org>/<repo>/ 或直接放在 tmp_cache
    candidates = [
        tmp_cache / "hub" / Path(repo_id).parent.name / Path(repo_id).name,
        snapshot_dir,
    ]
    src = next((c for c in candidates if c.is_dir()), snapshot_dir)
    _move_contents(src, target)
    shutil.rmtree(tmp_cache, ignore_errors=True)

    print(f"✅ {name}: → {target} ({_human_size(_dir_size(target))})")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--model",
        nargs="+",
        choices=list(DEFAULT_MODELS.keys()) + ["all"],
        default=["all"],
        help="要下载的模型（默认 all）",
    )
    parser.add_argument(
        "--target-dir",
        type=Path,
        default=DEFAULT_MODEL_DIR,
        help="模型根目录（默认 ./data/models）",
    )
    args = parser.parse_args()

    targets = list(DEFAULT_MODELS.keys()) if "all" in args.model else args.model
    args.target_dir.mkdir(parents=True, exist_ok=True)

    print(f"📦 模型根目录: {args.target_dir}")
    print(f"   下载列表: {', '.join(targets)}\n")

    failures = 0
    for name in targets:
        try:
            download_one(name, DEFAULT_MODELS[name], args.target_dir / name)
        except Exception as e:
            print(f"❌ {name} 下载失败: {e}", file=sys.stderr)
            failures += 1

    if failures:
        print(f"\n⚠️  {failures} 个模型下载失败，请检查网络或重试", file=sys.stderr)
        return 1

    print("\n🎉 全部完成。下次启动容器会自动从本地加载，零下载。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
