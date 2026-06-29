#!/usr/bin/env bash
# v信 数据库备份脚本
# 由 setup-new-server.sh 安装到 /usr/local/bin/vxin-backup，cron 每日 03:00 执行
set -euo pipefail

: "${VXIN_ROOT:?需要 VXIN_ROOT 环境变量（由安装脚本设定）}"
ENV_FILE="$VXIN_ROOT/backend-v2/.env"

# 从 .env 读取路径配置（可被环境变量覆盖）
[[ -f "$ENV_FILE" ]] && source <(grep -E "^(DB_PATH|UPLOADS_ROOT|ALERT_BOT_TOKEN|ALERT_CHAT_ID)=" "$ENV_FILE") 2>/dev/null || true

DB="${DB_PATH:-$VXIN_ROOT/backend-v2/wechat.db}"
UPLOADS_DIR="${UPLOADS_ROOT:-$VXIN_ROOT/backend-v2/uploads}"
BACKUP_DIR="${BACKUP_DIR:-/var/backup/vxin}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BOT_TOKEN="${ALERT_BOT_TOKEN:-}"
CHAT_ID="${ALERT_CHAT_ID:-}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
tg()  {
  [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]] && return 0
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${CHAT_ID}" -d "text=$1" -o /dev/null
}

command -v sqlite3 >/dev/null || { log "❌ sqlite3 未安装: apt install sqlite3"; exit 1; }
[[ -f "$DB" ]] || { log "❌ DB 文件不存在: $DB"; tg "❌ v信备份失败: DB不存在"; exit 1; }
mkdir -p "$BACKUP_DIR"

DATE=$(date +%Y%m%d_%H%M%S)

# 1. 数据库备份
log "备份 $DB → $BACKUP_DIR/vxin-$DATE.db"
sqlite3 "$DB" ".backup $BACKUP_DIR/vxin-$DATE.db"
gzip "$BACKUP_DIR/vxin-$DATE.db"
DB_SIZE=$(du -sh "$BACKUP_DIR/vxin-$DATE.db.gz" | cut -f1)
log "✅ 数据库: vxin-$DATE.db.gz ($DB_SIZE)"

# 2. 用户上传文件备份
if [[ -d "$UPLOADS_DIR" ]]; then
  UPLOADS_BAK="$BACKUP_DIR/uploads-$DATE.tar.gz"
  tar -czf "$UPLOADS_BAK" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")" 2>/dev/null || true
  UP_SIZE=$(du -sh "$UPLOADS_BAK" 2>/dev/null | cut -f1 || echo "0")
  log "✅ 上传文件: uploads-$DATE.tar.gz ($UP_SIZE)"
fi

SIZE="$DB_SIZE"

# 清理过期备份
DELETED=$(find "$BACKUP_DIR" -name "vxin-*.db.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
[[ "$DELETED" -gt 0 ]] && log "清理 ${DELETED} 个 >$KEEP_DAYS 天的数据库备份"

# 磁盘告警
DISK=$(df "$BACKUP_DIR" | awk 'NR==2{print $5}' | tr -d '%')
if [[ "${DISK:-0}" -gt 85 ]]; then
  MSG="🟡 v信磁盘告警: 备份目录 ${DISK}% 已用"
  log "$MSG"; tg "$MSG"
fi

log "备份目录: $(du -sh "$BACKUP_DIR" | cut -f1)"
tg "✅ v信备份成功 $DATE (DB:$DB_SIZE)"
