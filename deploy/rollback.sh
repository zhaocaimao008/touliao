#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# v信 一键回滚脚本
#
# 用法:
#   bash deploy/rollback.sh           # 回滚到上一个 commit（最常用）
#   bash deploy/rollback.sh <hash>    # 回滚到指定 commit
#   bash deploy/rollback.sh --db <backup.db.gz>  # 从备份恢复 DB
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }
step() { echo -e "\n${YEL}── $* ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BE="$ROOT/backend-v2"
PM2_APP="vxin-server-v2"
MODE=""
TARGET=""
DB_BACKUP=""

# ── 解析参数 ────────────────────────────────────────────────────────────────
case "${1:-}" in
  --db)
    MODE="db"
    DB_BACKUP="${2:-}"
    [[ -f "$DB_BACKUP" ]] || die "备份文件不存在: $DB_BACKUP"
    ;;
  "")
    MODE="code"
    TARGET="HEAD~1"
    ;;
  --*)
    die "未知选项: $1\n用法: bash rollback.sh [<commit_hash>] [--db <backup.db.gz>]"
    ;;
  *)
    MODE="code"
    TARGET="$1"
    ;;
esac

# ── 健康检查函数 ─────────────────────────────────────────────────────────────
check_health() {
  local url="${APP_URL:-http://127.0.0.1:3002}/health"
  for i in $(seq 1 10); do
    if curl -sf "$url" -o /dev/null --max-time 5; then
      ok "健康检查通过: $url"
      return 0
    fi
    echo -n "."
    sleep 2
  done
  return 1
}

# ════════════════════════════════════════════════════════════════════
if [[ "$MODE" == "code" ]]; then
# ── 代码回滚 ───────────────────────────────────────────────────────
  step "当前版本"
  CURRENT=$(git -C "$ROOT" rev-parse --short HEAD)
  CURRENT_MSG=$(git -C "$ROOT" log -1 --format="%s")
  warn "当前: $CURRENT $CURRENT_MSG"

  step "目标版本"
  TARGET_HASH=$(git -C "$ROOT" rev-parse --short "$TARGET" 2>/dev/null) || \
    die "找不到 commit: $TARGET"
  TARGET_MSG=$(git -C "$ROOT" log -1 --format="%s" "$TARGET_HASH")
  warn "目标: $TARGET_HASH $TARGET_MSG"

  echo ""
  read -rp "确认回滚到 $TARGET_HASH ? [y/N] " confirm
  [[ "$confirm" =~ ^[yY]$ ]] || { warn "取消"; exit 0; }

  step "切换代码"
  git -C "$ROOT" checkout "$TARGET_HASH" -- backend-v2/src backend-v2/package.json

  step "安装依赖（如有变化）"
  cd "$BE" && npm ci --production --quiet

  step "重启后端"
  pm2 restart "$PM2_APP" 2>/dev/null || pm2 start "$BE/src/server.js" --name "$PM2_APP"

  step "验证健康"
  sleep 2
  if check_health; then
    ok "回滚成功 → $TARGET_HASH $TARGET_MSG"
    echo ""
    echo -e "${GRN}  如需固化回滚，请 git revert 并 push:${NC}"
    echo "    git revert HEAD --no-edit && git push origin main"
  else
    die "健康检查失败！后端未正常启动，查看: pm2 logs $PM2_APP --lines 50"
  fi

# ════════════════════════════════════════════════════════════════════
elif [[ "$MODE" == "db" ]]; then
# ── DB 从备份恢复 ──────────────────────────────────────────────────
  DB_PATH="${DB_PATH:-$BE/wechat.db}"

  step "停止后端（防止写入冲突）"
  pm2 stop "$PM2_APP" 2>/dev/null || warn "pm2 进程未运行"

  step "备份当前 DB（安全）"
  SAFETY="$DB_PATH.rollback-$(date +%Y%m%d_%H%M%S)"
  cp "$DB_PATH" "$SAFETY"
  ok "当前 DB 已备份: $SAFETY"

  step "解压并恢复 DB"
  TMPDB="/tmp/vxin-restore-$$.db"
  if [[ "$DB_BACKUP" == *.gz ]]; then
    gunzip -c "$DB_BACKUP" > "$TMPDB"
  else
    cp "$DB_BACKUP" "$TMPDB"
  fi
  sqlite3 "$TMPDB" ".backup $DB_PATH"
  rm -f "$TMPDB"
  ok "DB 已恢复: $DB_PATH"

  step "重启后端"
  pm2 start "$PM2_APP" 2>/dev/null || pm2 start "$BE/src/server.js" --name "$PM2_APP"

  step "验证健康"
  sleep 2
  if check_health; then
    ok "DB 恢复成功"
  else
    warn "健康检查失败，尝试恢复安全备份..."
    pm2 stop "$PM2_APP"
    cp "$SAFETY" "$DB_PATH"
    pm2 start "$PM2_APP"
    die "DB 恢复失败。已还原到 $SAFETY，请人工检查"
  fi
fi
