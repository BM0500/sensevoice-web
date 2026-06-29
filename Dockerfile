# ─────────── Stage 1: 构建前端 ───────────
FROM docker.nju.edu.cn/library/node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# 仅先复制 package 文件以利用 Docker 缓存
COPY frontend/package.json frontend/package-lock.json* ./
# 使用国内 npm 镜像加速
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci --no-audit --no-fund

# 再复制源码并构建
COPY frontend/ ./
RUN npm run build

# ─────────── Stage 2: 后端运行时 ───────────
FROM docker.nju.edu.cn/library/python:3.10-slim

WORKDIR /app

# 音频处理依赖（使用国内 apt 源，加快速度）
RUN sed -i 's/deb.debian.org/mirrors.ustc.edu.cn/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    apt-get update && apt-get install -y --no-install-recommends \
        libsndfile1 \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖（使用国内 pip 源）
COPY requirements.txt .
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# 应用代码
COPY app.py ./
COPY backend/ ./backend/

# 前端构建产物（来自上一阶段）
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# 模型目录 + 临时目录 + 日志目录（运行时由 docker-compose 挂载到 ./data）
RUN mkdir -p /app/models /app/tmp /app/logs

# ────────── N100 4C4T 调优：把线程数钉死在镜像里 ──────────
# 进程级线程数（覆盖 host 默认值）。funasr 内部 torch/onnxruntime 都会读。
# 4 核留 1 核给 ffmpeg/系统，推理最多 3 线程
ENV OMP_NUM_THREADS=3 \
    MKL_NUM_THREADS=3 \
    OPENBLAS_NUM_THREADS=3 \
    TORCH_NUM_THREADS=3 \
    TORCH_CPU_NUM_THREADS=3 \
    NUMEXPR_NUM_THREADS=3 \
    OMP_WAIT_POLICY=ACTIVE \
    MALLOC_ARENA_MAX=2 \
    PYTHONUNBUFFERED=1

# 推理优化默认值（可在 docker-compose 环境变量里覆盖）
ENV USE_QUANTIZE=true \
    INTRA_OP_THREADS=3 \
    INTER_OP_THREADS=1 \
    FFMPEG_THREADS=1 \
    SINGLE_FLIGHT=true \
    TEMP_DIR=/app/tmp

EXPOSE 8000

CMD ["python", "app.py"]