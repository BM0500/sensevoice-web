# SenseVoice Web

基于 [FunASR SenseVoiceSmall](https://github.com/modelscope/FunASR) 的语音识别 Web 服务，针对 **N100 / 低功耗 NAS / 无 GPU** 场景做了深度优化（4C4T 单飞、ONNX INT8、VNNI 指令）。

## ✨ 特性

- 🎙️ 音频 + 视频识别（视频自动 ffmpeg 抽音轨）
- 📦 批量上传（最多 20 个文件 / 单任务 500 MB）
- 📜 历史记录 + TXT 导出
- 🌓 暗色 / 亮色主题
- 🐳 Docker Compose 一键部署
- ⚡ 模型本地缓存，二次启动零下载

## 🚀 快速开始

### Docker Compose（推荐）

> 🟢 **绿联 DXP4800 (N100) 用户**：直接看 [docs/deploy-dxp4800.md](docs/deploy-dxp4800.md) 一份完整手册，含目录规划、一键脚本、调优建议、FAQ。

```bash
# 1. 准备 .env（按需修改）
cp .env.example .env

# 2. 下载模型到 ./data/models/（首次必须，之后永久离线）
python scripts/download_model.py

# 3. 启动
docker compose up -d --build

# 4. 访问
open http://localhost:8000
```

### 本地开发

```bash
# 后端
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python scripts/download_model.py
python app.py

# 前端（新终端）
cd frontend && npm install && npm run dev
# → http://localhost:5173（自动代理 /api 到 8000）
```

## 📁 数据目录布局

部署后 `./data/` 是 NAS 持久化卷，建议放 RAID 或定期备份：

```
data/
├── models/                   # 模型文件（≈ 310 MB）
│   ├── sensevoice/           # iic/SenseVoiceSmall
│   ├── vad/                  # fsmn-vad
│   └── punc/                 # ct-punc
├── temp/                     # 上传临时文件 + 视频抽音轨产物
└── logs/                     # 容器 stdout/stderr
```

> 💡 **多机共享模型**：把 `./data/models/` 放到 NFS / SMB 共享目录，所有容器挂载同一份即可。

## 🔧 关键配置（`.env`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8000` | 服务端口 |
| `MAX_UPLOAD_SIZE_MB` | `500` | 单任务总上传上限 |
| `MAX_FILES_PER_JOB` | `20` | 单任务最大文件数 |
| `USE_QUANTIZE` | `true` | ONNX INT8 量化（用上 N100 VNNI） |
| `INTRA_OP_THREADS` | `3` | 推理线程数（4 核留 1 给系统） |
| `SINGLE_FLIGHT` | `true` | 同时只跑一个识别任务 |
| `MODEL_DIR` | `./data/models/sensevoice` | SenseVoice 本地路径，留空走 ModelScope |
| `VAD_MODEL_DIR` | `./data/models/vad` | VAD 本地路径 |
| `PUNC_MODEL_DIR` | `./data/models/punc` | 标点本地路径 |
| `JOB_TTL_SECONDS` | `3600` | 历史任务保留时间 |

## 🩺 健康检查

```bash
curl http://localhost:8000/api/health    # → {"status":"ok",...}
curl http://localhost:8000/api/status    # → 模型就绪状态 + 当前活跃任务
```

## 📝 模型手动管理

```bash
# 下载全部
python scripts/download_model.py

# 下载单个
python scripts/download_model.py --model vad

# 自定义 ModelScope repo
SENSEVOICE_REPO=iic/SenseVoiceSmall python scripts/download_model.py

# 升级模型：删目录后重新下载
rm -rf data/models/sensevoice && python scripts/download_model.py --model sensevoice
```

## 🛠️ API

| Method | Path | 说明 |
|---|---|---|
| `GET`  | `/api/health` | 健康检查 |
| `GET`  | `/api/status` | 模型状态 |
| `POST` | `/api/transcribe` | 上传文件（multipart）创建任务 |
| `GET`  | `/api/jobs/{id}` | 查询任务状态（含实时进度） |
| `GET`  | `/api/jobs?limit=50` | 历史列表（仅终态） |
| `DELETE` | `/api/jobs/{id}` | 删除任务（仅终态） |
| `GET`  | `/api/jobs/{id}/export` | 导出 TXT |
| `GET`  | `/docs` | Swagger UI |

## 📋 系统要求

- CPU: 现代 x86_64（推荐带 AVX2，N100 完整支持 VNNI）
- 内存: 建议 ≥ 4 GB（容器限制 4 GB）
- 磁盘: 模型 + 临时文件约 1 GB
- OS: Linux（已用 Debian slim 验证；macOS 仅开发）

### 💾 NAS 磁盘实际占用预估

| 传输内容 | 大小 | 说明 |
|---|---|---|
| 源码 tarball（不含大资产） | ~600 KB | 上传项目代码 |
| 模型（首次） | 1.2 GB | `download_model.py` 在容器内下载，或预先 scp |
| Docker 镜像（pull 后） | ~3-4 GB | python:3.10-slim + npm + 所有 Python 包 |
| **NAS 磁盘实际占用** | **~5 GB** | 镜像 + 模型 + 数据 |

> 模型 + 镜像 vs 代码 ≈ **4500 : 1**，项目本质上是个壳子，值钱的东西都在模型和依赖里。

## 📚 部署文档

| 文档 | 适用 |
|---|---|
| [docs/deploy-dxp4800.md](docs/deploy-dxp4800.md) | 绿联 DXP4800 / N100 / 个人自用完整手册 |
| [docs/ai-integration.md](docs/ai-integration.md) | AI Agent / OpenAI SDK / MCP 接入指南 |
| `.env.nas` | DXP4800 专属环境变量模板 |
| `scripts/deploy-nas.sh` | 一键部署/更新/维护脚本 |

通用 Linux NAS（x86_64）用户可参考 [docs/deploy-dxp4800.md](docs/deploy-dxp4800.md) 的章节结构，路径替换为自己的实际挂载点即可。

## 🤖 AI Agent 接入（OpenAI 兼容）

`POST /v1/audio/transcriptions` — 任何支持 OpenAI SDK 的工具/agent 都能直接调，无需适配：

```python
from openai import OpenAI
client = OpenAI(base_url="http://nas.local:18080/v1", api_key="not-needed")
result = client.audio.transcriptions.create(model="sensevoice", file=open("a.mp3","rb"))
print(result.text)
```

支持 `response_format`: `json` / `text` / `srt` / `vtt`，`language`: `auto` / `zh` / `en` / `yue` / `ja` / `ko`。详见 [docs/ai-integration.md](docs/ai-integration.md)。

## 📄 License

本项目仅作个人 NAS 部署模板，模型权重遵循 [ModelScope](https://www.modelscope.cn/) 许可。