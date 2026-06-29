# 绿联云 DXP4800 部署指南

> **目标硬件**：绿联 DXP4800（Intel N100 / 16GB DDR5 / 无独立显卡）
> **场景**：纯个人自用 · 无并发 · 美观实用 UI
> **预计耗时**：首次 30–60 分钟（含模型下载 ~310MB）

本项目本身就是为 N100 NAS 场景量身调优（ONNX INT8 + VNNI、单飞、3 线程预钉死），在 DXP4800 上开箱即用。本指南把"零到能用"的完整路径写成一份逐步手册。

---

## 📋 目录

- [前置检查](#前置检查)
- [硬件匹配度](#硬件匹配度)
- [目录规划](#目录规划)
- [部署步骤](#部署步骤)
- [日常维护](#日常维护)
- [备份与恢复](#备份与恢复)
- [常见问题](#常见问题)
- [进阶调优](#进阶调优)

---

## 前置检查

### 1. 确认 UGOS 已开启 Docker 能力

DXP4800 的 UGOS 自带 Docker，但 Compose 入口可能藏在应用中心：

1. 登录 UGOS Web 管理（通常 `http://nas.local` 或 `http://192.168.x.x`）
2. 应用中心 → 搜索 "Docker" 或 "容器"
3. 若未安装，先安装 UGOS 官方 Docker 应用
4. 验证 Compose 可用：进入容器界面，应能看到 "compose" 或 "堆栈" 选项

### 2. 启用 SSH（推荐，便于命令行操作）

设置 → 开发者模式 → 开启 SSH。

```bash
# 从 Mac/Linux 验证 SSH
ssh sun@nas.local        # 用户名换成你的 UGOS 登录用户
```

### 3. 确认 DXP4800 型号（避免误用其他型号的指南）

```bash
ssh sun@nas.local "cat /proc/cpuinfo | grep 'model name' | head -1"
# 期望输出：model name : Intel(R) N100
```

> ⚠️ 绿联还有 DXP2800 / DXP6800 等型号，本文针对 **DXP4800 (N100)**。如果是 N100 同系列可参考，其他 CPU 型号请看通用部署章节。

---

## 硬件匹配度

| 硬件 | 项目侧优化 | DXP4800 实测 |
|---|---|---|
| CPU N100（4C4T，无超线程） | `INTRA_OP_THREADS=3` 留 1 核给 ffmpeg | ✅ 完美匹配 |
| AVX2 + VNNI | ONNX INT8 量化用上 VNNI 指令 | ✅ N100 全支持 |
| 16GB DDR5 | 容器限制 4GB | ✅ 留 12GB 给 NAS 系统 |
| 无独立显卡 | 强制 CPU 推理 | ✅ 不需要任何 GPU 驱动 |
| SATA/NVMe 盘位 | 模型放独立卷 | ✅ `./data/models` 持久化 |

**资源占用估算**（实测经验值）：
- 静态内存：~1.5 GB（funasr + torch + onnxruntime）
- 单任务峰值：~2.5 GB（ffmpeg 抽音 + ASR 推理）
- 模型缓存：~310 MB（sensevoice + vad + punc）
- 日志：默认 10MB × 3 = 30 MB

→ 容器限制 4 GB 完全够用，余量给 NAS 系统。

---

## 目录规划

### 推荐目录结构

```
/mnt/dockervol/sensevoice/         ← 项目根（可改名）
├── docker-compose.yml             ← 项目自带
├── .env                           ← 项目自带，按需修改
├── app.py / backend/              ← 项目自带
├── frontend/                      ← 项目自带
├── scripts/                       ← 项目自带
├── data/
│   ├── models/                    ← 模型文件 (~310 MB，建议放 SSD 卷)
│   │   ├── sensevoice/
│   │   ├── vad/
│   │   └── punc/
│   ├── temp/                      ← 临时上传 + 抽音产物 (会清空)
│   └── logs/                      ← 容器 stdout/stderr
└── docs/                          ← 项目自带
```

> 💡 **挂载点选择**：DXP4800 多盘位时建议把 `data/models` 放 SSD 卷（IO 影响首启动），其余放机械盘即可。

### 创建目录

```bash
ssh sun@nas.local

# 一次性创建所有目录
sudo mkdir -p /mnt/dockervol/sensevoice/{data/models,data/temp,data/logs}

# 把所有权交给当前用户（避免容器内 root 写入受限）
sudo chown -R $USER:$USER /mnt/dockervol/sensevoice
cd /mnt/dockervol/sensevoice
```

---

## 部署步骤

### 步骤 1：上传项目代码

```bash
# 在你的 Mac/Linux 电脑上
scp -r sensevoice-web sun@nas.local:/mnt/dockervol/

# 验证
ssh sun@nas.local "ls /mnt/dockervol/sensevoice-web/"
```

> 如果用 `git clone` 更方便：
> ```bash
> ssh sun@nas.local "cd /mnt/dockervol && git clone <repo-url> sensevoice-web"
> ```

### 步骤 2：配置 `.env`

项目根目录下有 `.env.example`，复制并修改：

```bash
cd /mnt/dockervol/sensevoice-web
cp .env.example .env
nano .env   # 或 vim / vscode remote
```

**DXP4800 推荐配置**：

```bash
# ──────── 网络 ────────
PORT=18080                    # 避开 UGOS 系统端口（默认 8000 易冲突）

# ──────── 上传限制 ────────
MAX_UPLOAD_SIZE_MB=1000       # 个人用放宽到 1GB
MAX_FILES_PER_JOB=10          # 减小并发压力（N100 4C4T）

# ──────── 模型路径（容器内绝对路径） ────────
MODEL_DIR=/app/models/sensevoice
VAD_MODEL_DIR=/app/models/vad
PUNC_MODEL_DIR=/app/models/punc

# ──────── N100 调优（保持默认即可） ────────
USE_QUANTIZE=true             # ONNX INT8 + VNNI 加速
INTRA_OP_THREADS=3            # 推理线程
INTER_OP_THREADS=1
FFMPEG_THREADS=1
SINGLE_FLIGHT=true            # 单飞，个人用足够
TEMP_DIR=/app/tmp             # 容器内临时目录（已通过 docker-compose 持久化到 ./data/temp）

# ──────── 历史 ────────
JOB_TTL_SECONDS=86400         # 24 小时（默认 1 小时太短，个人用可放宽）
```

> 💡 容器内的 `/app/models`、`/app/tmp`、`/app/logs` 在 `docker-compose.yml` 里已 bind mount 到 `./data/{models,temp,logs}`，**不要在 `.env` 里改路径指向宿主机**，否则容器内找不到。

### 步骤 3：下载模型（首次必须）

模型约 310 MB，下载到 `./data/models/`。两种方式：

#### 方式 A：宿主机直接下载（**推荐**，速度快）

```bash
cd /mnt/dockervol/sensevoice-web

# 一次性临时容器下载
docker run --rm \
  -v "$(pwd)/data/models:/app/models" \
  -w /work \
  python:3.10-slim bash -c "
    pip install -q -i https://pypi.tuna.tsinghua.edu.cn/simple modelscope && \
    python scripts/download_model.py
  "
```

#### 方式 B：构建镜像后下载

```bash
docker compose build
docker compose run --rm sensevoice python scripts/download_model.py
```

#### 验证模型

```bash
ls -la data/models/sensevoice/ | head -10
# 应看到：config.yaml, configuration.json, model.pt, tokens.json 等

# 检查总大小
du -sh data/models/
# 应输出 ~310M
```

### 步骤 4：启动服务

```bash
cd /mnt/dockervol/sensevoice-web
docker compose up -d --build

# 查看启动日志（首次启动含模型预热，约 30-60s）
docker compose logs -f sensevoice
```

看到 `模型就绪 ✓` 字样即表示可用。按 `Ctrl+C` 退出日志跟随。

### 步骤 5：验证

```bash
# 健康检查
curl http://nas.local:18080/api/health
# 期望：{"status":"ok","ts":1700000000}

# 模型状态
curl http://nas.local:18080/api/status
# 期望：{"model_loaded":true,"active_jobs":0}
```

打开浏览器访问 **http://nas.local:18080**（或 `http://<NAS-IP>:18080`）。

> 🎉 至此部署完成！

---

## 日常维护

### 常用命令速查

```bash
# 切换到项目目录
cd /mnt/dockervol/sensevoice-web

# 查看实时日志
docker compose logs -f

# 查看最近 100 行日志
docker compose logs --tail=100

# 重启服务
docker compose restart

# 停止服务（保留数据）
docker compose down

# 彻底清理（连同数据卷，慎用！）
docker compose down -v

# 查看资源占用
docker stats sensevoice-web

# 进入容器调试
docker compose exec sensevoice bash

# 查看磁盘占用
du -sh data/*
```

### 代码更新流程

```bash
cd /mnt/dockervol/sensevoice-web

# 如果用 git
git pull
docker compose up -d --build

# 如果手动 scp
scp -r src/ sun@nas.local:/mnt/dockervol/sensevoice-web/frontend/src/
docker compose up -d --build frontend  # 仅重建前端层
```

### 清理临时文件

`./data/temp/` 存的是上传临时文件 + 视频抽出的 16kHz WAV。识别完自动清理，无需手动操作。

如果想强制清理：

```bash
docker compose exec sensevoice sh -c "rm -f /app/tmp/*.wav /app/tmp/*"
```

### 更新模型

```bash
# 删除旧模型（会触发重新下载）
rm -rf data/models/sensevoice

# 重新下载
docker compose run --rm sensevoice python scripts/download_model.py --model sensevoice
```

---

## 备份与恢复

### 建议备份

| 路径 | 重要性 | 备份建议 |
|---|---|---|
| `data/models/` | ⭐⭐ | **不需要**（可重新下载） |
| `data/temp/` | ⭐ | **不需要**（临时文件） |
| `data/logs/` | ⭐ | 可选（排查问题用） |
| `.env` | ⭐⭐⭐ | **必备份**（端口/路径配置） |
| `docker-compose.yml` | ⭐⭐⭐ | **必备份**（与上游同步成本高） |

### 一键备份

```bash
cd /mnt/dockervol
tar czf sensevoice-backup-$(date +%Y%m%d).tar.gz \
    --exclude='sensevoice-web/data/models' \
    --exclude='sensevoice-web/data/temp' \
    sensevoice-web/

# 上传到云盘 / 备份盘
```

### 迁移到另一台 NAS

```bash
# 旧 NAS：打包（不含模型）
tar czf sensevoice-migrate.tar.gz --exclude='data/models' --exclude='data/temp' sensevoice-web/

# 新 NAS：解压
tar xzf sensevoice-migrate.tar.gz -C /mnt/dockervol/

# 下载模型
cd /mnt/dockervol/sensevoice-web
docker compose run --rm sensevoice python scripts/download_model.py

# 启动
docker compose up -d --build
```

---

## 常见问题

### Q1：启动后访问 502 / "模型加载中"

**原因**：模型还在预热（首次需 ~30-60 秒）。
**解决**：等 1 分钟后刷新，或 `curl http://nas.local:18080/api/status` 看 `model_loaded` 字段。

### Q1.5：启动日志报"本地目录缺少必需文件"

**原因**：模型目录存在但**文件不完整**（之前下载中断、误删、人工 mkdir 等）。新版 `_resolve_model()` 会主动校验必需文件并警告。
**日志示例**：
```
ASR 模型：本地目录 /app/models/sensevoice 缺少必需文件 ['model.pt']。
建议修复：rm -rf /app/models/sensevoice && python scripts/download_model.py --model asr
```
**修复**：直接复制日志里的命令跑（注意在容器内或宿主机对应路径下执行）：

```bash
# 宿主机直接修复（推荐，避开容器）
cd /mnt/dockervol/sensevoice-web
rm -rf data/models/sensevoice
python scripts/download_model.py --model sensevoice
docker compose restart sensevoice

# 或容器内修复（更彻底，会刷新 mount）
docker compose down
rm -rf data/models/sensevoice
docker compose run --rm sensevoice python scripts/download_model.py --model sensevoice
docker compose up -d
```

**三个模型的必需文件清单**（任一缺失即视为半残废）：

| 模型 | 必需文件 |
|---|---|
| SenseVoice (ASR) | `config.yaml`, `model.pt`, `tokens.json` |
| VAD | `config.yaml`, `model.pt`, `am.mvn` |
| PUNC | `config.yaml`, `model.pt` |

### Q2：端口 18080 被占用

```bash
# 查谁在占用
ssh sun@nas.local "sudo lsof -i :18080"

# 修改 .env 的 PORT，重启
docker compose restart
```

### Q3：上传报 "Total size exceeds..."

`MAX_UPLOAD_SIZE_MB` 限制。修改 `.env`：
```bash
MAX_UPLOAD_SIZE_MB=2000
docker compose restart
```

### Q4：识别准确率低 / 速度慢

1. **慢**：检查 `docker compose logs` 是否有 OOM。如果是，调高 `deploy.resources.limits.memory`。
2. **不准确**：上传音频质量差（强噪音、电话音）—— 上游 SenseVoice 模型本身的能力边界。

### Q5：磁盘满了

```bash
# 看哪个目录占空间
du -sh data/*

# 临时方案：清理 temp + logs
rm -rf data/temp/* data/logs/*

# 长期方案：扩大 NAS 卷 / 迁移到独立盘
```

### Q6：忘记 Web 端口了

```bash
grep "^PORT" .env
# 或
docker compose port sensevoice 8000
```

### Q7：容器重启后任务历史没了

**原因**：当前实现是**内存存储**（重启清空），不是 Redis/DB。
**影响**：仅丢失历史面板数据，**正在处理的任务会因为容器重启而中断**。
**解决**：
- 个人用不强求持久化
- 如需持久化，可后续扩展 backend `jobs.py` 加 SQLite 存储

### Q8：能否在外网访问？

**可以但不推荐**（个人自用）：

```bash
# 简单方案：路由器端口转发 NAS_IP:18080 → 公网
# 安全方案：NAS 部署 WireGuard/Tailscale，外网先连回家
```

---

## 进阶调优

### 关闭标点模型（如果你想更快的首字延迟）

标点模型 ~50MB，启动多花 ~5 秒。如果只用中文短句识别，可关闭：

修改 `backend/model.py` 第 89 行附近：
```python
kwargs = dict(
    model=model_path,
    vad_model=vad_path,
    # punc_model=punc_path,   # 注释掉
    device=MODEL_DEVICE,
    ...
)
```

> ⚠️ 关闭后识别结果没有标点，但启动变快。

### 关闭 VAD（如果你只识别 < 1 分钟的短音频）

VAD 在短音频上反而是负担。修改 `backend/model.py`：
```python
kwargs = dict(
    model=model_path,
    # vad_model=vad_path,      # 注释掉
    punc_model=punc_path,
    ...
)
```

### 降低内存占用（保守到极致）

```yaml
# docker-compose.yml
deploy:
  resources:
    limits:
      memory: 3G       # 4G → 3G
    reservations:
      memory: 1.5G
```

仅在跑 < 30 秒短音频时考虑，长音频会 OOM。

### 加 watchdog 监控（可选）

如果你想 NAS 重启后自动恢复容器：

```bash
# UGOS Docker 应用里开启 "restart unless stopped"
# 或 docker-compose.yml 已默认配置 restart: unless-stopped
```

---

## 🆘 仍然搞不定？

1. 看 `docker compose logs --tail=200` 找具体错误
2. 在 GitHub Issues 搜同类问题
3. 提 Issue 时附上：
   - `docker compose logs` 完整输出
   - `docker stats sensevoice-web` 资源截图
   - NAS 型号 / UGOS 版本 / 内存

> 本项目只作个人 NAS 部署模板，模型权重遵循 ModelScope 许可。