#!/bin/bash
# ──────────────────────────────────────────────────────────────
# SenseVoice Web · DXP4800 一键部署/更新脚本
# 适用场景：项目根目录已上传到 NAS，docker compose 已可用
#
# 用法：
#   ./scripts/deploy-nas.sh deploy    # 首次部署（含下载模型）
#   ./scripts/deploy-nas.sh update    # 拉代码 + 重启
#   ./scripts/deploy-nas.sh start     # 启动
#   ./scripts/deploy-nas.sh stop      # 停止
#   ./scripts/deploy-nas.sh restart   # 重启
#   ./scripts/deploy-nas.sh logs      # 实时日志
#   ./scripts/deploy-nas.sh status    # 健康状态
#   ./scripts/deploy-nas.sh cleanup   # 清理临时文件 + 旧日志
# ──────────────────────────────────────────────────────────────
set -euo pipefail

# 切到项目根目录（无论从哪里调用）
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

# 颜色（终端可用时）
if [ -t 1 ]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

log()   { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

# ────────── 预检查 ──────────
preflight() {
    log "预检查..."

    # Docker 可用？
    if ! command -v docker >/dev/null 2>&1; then
        err "未找到 docker 命令。请在 UGOS 应用中心安装 Docker。"
        exit 1
    fi
    # docker compose 可用？
    if ! docker compose version >/dev/null 2>&1; then
        err "未找到 docker compose。UGOS Docker 应用可能版本太旧。"
        exit 1
    fi
    # .env 存在？
    if [ ! -f .env ]; then
        warn ".env 不存在，复制 .env.nas 模板"
        cp .env.nas .env
        ok "已生成 .env（按需修改）"
    fi
    # data 目录？
    mkdir -p data/{models,temp,logs}
    ok "目录就绪"
}

# ────────── 命令分发 ──────────
cmd="${1:-help}"
case "$cmd" in
    deploy)
        preflight
        log "首次部署：构建镜像..."
        docker compose build
        ok "镜像构建完成"

        # 模型下载（如果还没下载）
        if [ ! -f data/models/sensevoice/model.pt ]; then
            log "下载模型（约 310 MB，需要几分钟）..."
            docker compose run --rm sensevoice python scripts/download_model.py
            ok "模型下载完成"
        else
            log "模型已存在，跳过下载"
        fi

        log "启动服务..."
        docker compose up -d
        sleep 5
        if curl -fs http://localhost:${PORT:-18080}/api/health >/dev/null 2>&1; then
            ok "服务已启动 → http://localhost:${PORT:-18080}"
        else
            warn "健康检查未通过，请查看日志：$0 logs"
        fi
        ;;

    update)
        preflight
        log "停止现有服务..."
        docker compose down || true
        log "重建镜像..."
        docker compose build
        log "启动..."
        docker compose up -d
        ok "更新完成"
        ;;

    start)
        log "启动..."
        docker compose up -d
        ok "已启动"
        ;;

    stop)
        log "停止..."
        docker compose down
        ok "已停止"
        ;;

    restart)
        log "重启..."
        docker compose restart
        ok "已重启"
        ;;

    logs)
        docker compose logs -f --tail=100
        ;;

    status)
        log "容器状态："
        docker compose ps
        echo
        log "健康检查："
        curl -fs "http://localhost:${PORT:-18080}/api/health" 2>&1 || echo "后端不可达"
        echo
        log "模型状态："
        curl -fs "http://localhost:${PORT:-18080}/api/status" 2>&1 || true
        echo
        log "资源占用："
        docker stats --no-stream sensevoice-web 2>/dev/null || true
        echo
        log "磁盘占用："
        du -sh data/* 2>/dev/null
        ;;

    cleanup)
        log "清理临时文件 + 日志..."
        # 临时音轨
        find data/temp -type f -name "*.wav" -mmin +60 -delete 2>/dev/null || true
        # 旧上传（已识别的）
        find data/temp -type f -mmin +60 ! -name "*.wav" -delete 2>/dev/null || true
        # docker 日志截断
        docker compose exec -T sensevoice sh -c \
            'echo "" > /app/logs/*.log 2>/dev/null || true' || true
        ok "清理完成"
        du -sh data/* 2>/dev/null
        ;;

    help|*)
        cat <<EOF
SenseVoice Web · DXP4800 一键部署脚本

用法：$0 <command>

命令：
  deploy    首次部署（构建 + 拉模型 + 启动）
  update    拉代码后重启
  start     启动已构建的服务
  stop      停止服务
  restart   重启服务
  logs      查看实时日志
  status    查看容器 / 健康 / 模型 / 资源 / 磁盘
  cleanup   清理临时文件 + 日志
  help      显示本帮助

环境变量（在 .env 中）：
  PORT                 Web 端口（默认 18080）
  MAX_UPLOAD_SIZE_MB   单任务上传上限
  INTRA_OP_THREADS     推理线程数
  JOB_TTL_SECONDS      历史保留秒数

更多信息：docs/deploy-dxp4800.md
EOF
        ;;
esac