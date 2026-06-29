"""SenseVoice 语音识别服务 - 应用入口。"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router, start_cleanup_thread
from backend.api.v1_routes import router as v1_router
from backend.model import warmup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# 前端构建产物目录（可通过环境变量覆盖，便于 Docker / 自定义部署）
DIST_DIR = Path(os.getenv("FRONTEND_DIST", str(Path(__file__).parent / "frontend" / "dist")))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时预热模型 + 启动清理线程。"""
    logger.info("SenseVoice 服务启动中...")

    # 预热模型（耗时操作）
    err = warmup()
    if err:
        logger.error("模型预热失败: %s", err)
    else:
        logger.info("模型就绪 ✓")

    # 启动过期任务清理
    start_cleanup_thread()

    yield

    logger.info("SenseVoice 服务关闭")


app = FastAPI(
    title="SenseVoice API",
    description="基于 FunASR SenseVoiceSmall 的语音识别服务",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS：开发模式下前端 dev server 需要跨域
if os.getenv("ENV", "production") == "development":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(router)
app.include_router(v1_router)

# ────────────────────────── 前端静态资源（若已构建） ──────────────────────────
_HAS_FRONTEND = DIST_DIR.is_dir() and (DIST_DIR / "index.html").is_file()
if _HAS_FRONTEND:
    assets_dir = DIST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/", include_in_schema=False)
    def root():
        return FileResponse(str(DIST_DIR / "index.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        """SPA 路由回退：静态文件直接返回，其余统一返回 index.html。

        /api/*、/docs、/openapi.json 等在此路由之前已注册，不会被覆盖。
        """
        # 阻止目录穿越
        if ".." in full_path.split("/"):
            from fastapi import HTTPException

            raise HTTPException(400, "非法路径")
        candidate = DIST_DIR / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(DIST_DIR / "index.html"))

    logger.info("已挂载前端 dist: %s", DIST_DIR)
else:
    @app.get("/")
    def root():
        return {
            "name": "SenseVoice API",
            "version": "2.0.0",
            "docs": "/docs",
            "health": "/api/health",
            "frontend": "未构建（运行 frontend 目录的 npm run build）",
        }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)