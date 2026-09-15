#!/usr/bin/env bash
# 投聊 数据库备份脚本
# 由 setup-new-server.sh 安装到 /usr/local/bin/touliao-backup，cron 每日 03:00 执行
set -euo pipefail
umask 077

: "${TOULIAO_ROOT:?需要 TOULIAO_ROOT 环境变量（由安装脚本设定）}"
ENV_FILE="$TOULIAO_ROOT/backend-v2/.env"

# Preserve explicit overrides when reading the deployment's trusted configuration.
ENV_DB="${DB_PATH-}"; ENV_UPLOADS="${UPLOADS_ROOT-}"
[[ -f "$ENV_FILE" ]] && source <(grep -E "^(DB_PATH|UPLOADS_ROOT|ALERT_BOT_TOKEN|ALERT_CHAT_ID)=" "$ENV_FILE") 2>/dev/null || true
[[ -n "$ENV_DB" ]] && DB_PATH="$ENV_DB"
[[ -n "$ENV_UPLOADS" ]] && UPLOADS_ROOT="$ENV_UPLOADS"

DB="${DB_PATH:-$TOULIAO_ROOT/backend-v2/wechat.db}"
DEFAULT_UPLOADS="$TOULIAO_ROOT/backend-v2/uploads"
[[ -d "$TOULIAO_ROOT/backend/uploads" ]] && DEFAULT_UPLOADS="$TOULIAO_ROOT/backend/uploads"
UPLOADS_DIR="${UPLOADS_ROOT:-$DEFAULT_UPLOADS}"
[[ "$DB" = /* ]] || DB="$TOULIAO_ROOT/backend-v2/$DB"
[[ "$UPLOADS_DIR" = /* ]] || UPLOADS_DIR="$TOULIAO_ROOT/backend-v2/$UPLOADS_DIR"
BACKUP_DIR="${BACKUP_DIR:-/var/backup/touliao}"
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
[[ -f "$DB" ]] || { log "❌ DB 文件不存在: $DB"; tg "❌ 投聊备份失败: DB不存在"; exit 1; }
mkdir -p "$BACKUP_DIR"
[[ -d "$UPLOADS_DIR" ]] || { log "上传目录不存在: $UPLOADS_DIR"; exit 1; }
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || { log "另一个备份任务正在运行"; exit 1; }

DATE=$(date +%Y%m%d_%H%M%S_%N)
STAGING=$(mktemp -d "$BACKUP_DIR/.pending-XXXXXX")
cleanup() {
  local status=$?
  rm -rf "$STAGING"
  if [[ "$status" -ne 0 ]]; then
    log "投聊备份失败，未发布成功快照"
    tg "投聊备份失败 $DATE，请检查服务器日志" || true
  fi
}
trap cleanup EXIT

# 1. 数据库备份
log "备份 $DB → $BACKUP_DIR/touliao-$DATE.db"
sqlite3 "$DB" ".backup '$STAGING/snapshot.db'"
# Compare against the immutable snapshot, not a live database receiving writes.
SRC_USERS=$(sqlite3 "$STAGING/snapshot.db" "SELECT COUNT(*) FROM users;")
gzip "$STAGING/snapshot.db"
DB_SIZE=$(du -sh "$STAGING/snapshot.db.gz" | cut -f1)

# 1b. 恢复验证：只确认"文件生成了、大小不为0"不代表这份备份真的能被还原。
#     解压到临时文件，跑 PRAGMA integrity_check + 关键表行数比对，任何一步不通过
#     都视为本次备份失败（告警 + 非零退出），而不是静默留下一份实际不可用的备份。
VERIFY_TMP="$STAGING/verify.db"
gunzip -c "$STAGING/snapshot.db.gz" > "$VERIFY_TMP"
INTEGRITY=$(sqlite3 "$VERIFY_TMP" "PRAGMA integrity_check;" | head -1)
BAK_USERS=$(sqlite3 "$VERIFY_TMP" "SELECT COUNT(*) FROM users;")
rm -f "$VERIFY_TMP"
if [[ "$INTEGRITY" != "ok" || "$SRC_USERS" != "$BAK_USERS" ]]; then
  MSG="🔴 投聊备份恢复验证失败 $DATE: integrity=$INTEGRITY users(源=$SRC_USERS,备份=$BAK_USERS)"
  log "❌ $MSG"; tg "$MSG"
  exit 1
fi
log "✅ 恢复验证通过: integrity_check=ok, users行数一致($SRC_USERS)"

# 2. 用户上传文件备份
UPLOADS_BAK="$STAGING/uploads.tar.gz"
tar -czf "$UPLOADS_BAK" -C "$(dirname "$UPLOADS_DIR")" "$(basename "$UPLOADS_DIR")"
tar -tzf "$UPLOADS_BAK" >/dev/null
UP_SIZE=$(du -sh "$UPLOADS_BAK" | cut -f1)
mv "$UPLOADS_BAK" "$BACKUP_DIR/uploads-$DATE.tar.gz"
mv "$STAGING/snapshot.db.gz" "$BACKUP_DIR/touliao-$DATE.db.gz"
log "✅ 数据库: touliao-$DATE.db.gz ($DB_SIZE)"
log "✅ 上传文件: uploads-$DATE.tar.gz ($UP_SIZE)"

SIZE="$DB_SIZE"

# 清理过期备份
DELETED=$(find "$BACKUP_DIR" -name "touliao-*.db.gz" -mtime +"$KEEP_DAYS" -print -delete | wc -l)
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +"$KEEP_DAYS" -delete 2>/dev/null || true
[[ "$DELETED" -gt 0 ]] && log "清理 ${DELETED} 个 >$KEEP_DAYS 天的数据库备份"

# 磁盘告警
DISK=$(df "$BACKUP_DIR" | awk 'NR==2{print $5}' | tr -d '%')
if [[ "${DISK:-0}" -gt 85 ]]; then
  MSG="🟡 投聊磁盘告警: 备份目录 ${DISK}% 已用"
  log "$MSG"; tg "$MSG"
fi

log "备份目录: $(du -sh "$BACKUP_DIR" | cut -f1)"
tg "✅ 投聊备份成功 $DATE (DB:$DB_SIZE)"
