# ──────────────────────────────────────────────────────────────
# SenseVoice Web · 绿联 DXP4800 专用配置
# 适用：N100 4C4T / 16GB / 无显卡 / 个人单用户
# 用法：cp .env.nas .env  后按需修改
# ──────────────────────────────────────────────────────────────

# ────────── 网络（避开 UGOS 系统默认端口） ──────────
PORT=18080

# ────────── 上传限制（个人用可放宽） ──────────
MAX_UPLOAD_SIZE_MB=1000
MAX_FILES_PER_JOB=10

# ────────── 模型（容器内路径，由 docker-compose bind mount 到 ./data/models） ──────────
MODEL_DIR=/app/models/sensevoice
VAD_MODEL_DIR=/app/models/vad
PUNC_MODEL_DIR=/app/models/punc

# ────────── N100 推理调优（保持默认即可） ──────────
USE_QUANTIZE=true             # ONNX INT8 + VNNI 加速
INTRA_OP_THREADS=3            # 4C4T 留 1 核给系统/ffmpeg
INTER_OP_THREADS=1
FFMPEG_THREADS=1
SINGLE_FLIGHT=true            # 同时只跑一个任务，个人用足够
TEMP_DIR=/app/tmp

# ────────── 任务历史（个人用放宽到 24 小时） ──────────
JOB_TTL_SECONDS=86400