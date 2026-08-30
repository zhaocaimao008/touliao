#!/usr/bin/env bash
# ============================================================
# 投聊 备份恢复演练脚本
#
# 用法：./deploy/restore-drill.sh
#
# 做什么：
#   1. 执行一次真实备份（复用生产在用的 touliao-backup 脚本，走同一条路径）
#   2. 把备份独立解压恢复到临时文件（全程只读生产库 wechat.db，不写不覆盖）
#   3. 对比生产库和恢复库的表数量、每张表行数、几张核心表最新几条记录的完整内容
#   4. 任何一项不一致，标红报错并以非零状态退出；全部一致才算演练通过
#
# 行数比对说明：生产库在"备份前快照"和"备份后快照"之间还在正常处理真实流量，
# 不可能和某个时间点的备份快照行数完全相等。做法是给每张表的行数划一个
# [备份前, 备份后] 的合理区间（如果这段时间内有清理型任务导致行数下降，
# 区间会自动按 min/max 处理），恢复库的行数必须落在这个区间内，落在区间外
# 才是真正的异常信号，不是把"生产库还在正常写入"误判成"备份坏了"。
# ============================================================
set -euo pipefail

TOULIAO_ROOT="${TOULIAO_ROOT:-/root/touliao}"
PROD_DB="${DB_PATH:-$TOULIAO_ROOT/backend-v2/wechat.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backup/touliao}"
DRILL_TMP="$(mktemp -d /tmp/touliao-restore-drill.XXXXXX)"
trap 'rm -rf "$DRILL_TMP"' EXIT

RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; }
fail() { echo -e "${RED}[✗]${NC} $*"; }
die()  { fail "$*"; exit 1; }

command -v sqlite3 >/dev/null || die "sqlite3 未安装"
[[ -f "$PROD_DB" ]] || die "生产库不存在: $PROD_DB"

echo "════════════════════════════════════════════════"
echo " 投聊备份恢复演练  $(date '+%Y-%m-%d %H:%M:%S')"
echo " 生产库: $PROD_DB"
echo "════════════════════════════════════════════════"

# 核心 IM 数据表，额外做"最新几条记录逐行内容比对"（不只是数行数）
KEY_TABLES=(users messages conversations moments)

# 排除 FTS5 虚拟表的内部影子表（*_fts_content/*_fts_data/*_fts_idx 等），
# 这些表不是真实业务数据，行数会随 FTS5 内部实现变化，不适合做业务层面的比对。
TABLES=$(sqlite3 "$PROD_DB" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '*_fts_*' ORDER BY name;")
TABLE_COUNT=$(echo "$TABLES" | grep -c . || true)

echo
echo "── 1/4 记录备份前生产库状态（$TABLE_COUNT 张表）──"
declare -A PRE_COUNTS
for t in $TABLES; do
  PRE_COUNTS[$t]=$(sqlite3 "$PROD_DB" "SELECT COUNT(*) FROM \"$t\";")
done
ok "已记录 $TABLE_COUNT 张表的备份前行数快照"

echo
echo "── 2/4 执行真实备份 ──"
if [[ -x /usr/local/bin/touliao-backup ]]; then
  TOULIAO_ROOT="$TOULIAO_ROOT" /usr/local/bin/touliao-backup || die "备份脚本执行失败（含它内建的 integrity_check）"
elif [[ -f "$TOULIAO_ROOT/deploy/touliao-backup.sh" ]]; then
  TOULIAO_ROOT="$TOULIAO_ROOT" bash "$TOULIAO_ROOT/deploy/touliao-backup.sh" || die "备份脚本执行失败"
else
  die "找不到备份脚本：/usr/local/bin/touliao-backup 和 deploy/touliao-backup.sh 都不存在"
fi

LATEST_BAK=$(ls -t "$BACKUP_DIR"/touliao-*.db.gz 2>/dev/null | head -1)
[[ -n "$LATEST_BAK" ]] || die "备份完成后在 $BACKUP_DIR 里没找到 touliao-*.db.gz"
ok "定位到最新备份: $LATEST_BAK"

echo
echo "── 3/4 记录备份后生产库状态 + 独立恢复到临时文件 ──"
declare -A POST_COUNTS
for t in $TABLES; do
  POST_COUNTS[$t]=$(sqlite3 "$PROD_DB" "SELECT COUNT(*) FROM \"$t\";")
done

RESTORED_DB="$DRILL_TMP/restored.db"
gunzip -c "$LATEST_BAK" > "$RESTORED_DB"

INTEGRITY=$(sqlite3 "$RESTORED_DB" "PRAGMA integrity_check;" | head -1)
[[ "$INTEGRITY" == "ok" ]] || die "恢复库 PRAGMA integrity_check 失败: $INTEGRITY"
ok "恢复库 integrity_check = ok"

RESTORED_TABLE_COUNT=$(sqlite3 "$RESTORED_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '*_fts_*';")
if [[ "$RESTORED_TABLE_COUNT" != "$TABLE_COUNT" ]]; then
  fail "表数量不一致：生产库 $TABLE_COUNT 张，恢复库 $RESTORED_TABLE_COUNT 张"
  DRILL_FAIL=1
else
  ok "表数量一致：$TABLE_COUNT 张"
fi

echo
echo "── 4/4 逐表行数比对 ──"
DRILL_FAIL="${DRILL_FAIL:-0}"
for t in $TABLES; do
  restored_count=$(sqlite3 "$RESTORED_DB" "SELECT COUNT(*) FROM \"$t\";")
  pre=${PRE_COUNTS[$t]}
  post=${POST_COUNTS[$t]}
  lo=$(( pre < post ? pre : post ))
  hi=$(( pre > post ? pre : post ))
  if [[ "$restored_count" -ge "$lo" && "$restored_count" -le "$hi" ]]; then
    printf '  %-28s 恢复库=%-8s 区间=[%s, %s]  ✓\n' "$t" "$restored_count" "$lo" "$hi"
  else
    fail "$t: 恢复库行数($restored_count) 落在生产库观测区间 [$lo, $hi] 之外"
    DRILL_FAIL=1
  fi
done

echo
echo "── 关键表最新记录逐条比对（内容级别，不只是数量）──"
for t in "${KEY_TABLES[@]}"; do
  if ! echo "$TABLES" | grep -qx "$t"; then
    warn "关键表 $t 在生产库不存在，跳过"
    continue
  fi
  IDS=$(sqlite3 "$RESTORED_DB" "SELECT id FROM \"$t\" ORDER BY rowid DESC LIMIT 5;" 2>/dev/null || true)
  if [[ -z "$IDS" ]]; then
    warn "$t: 恢复库为空表，跳过逐条比对"
    continue
  fi
  MISS=0
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    restored_row=$(sqlite3 "$RESTORED_DB" "SELECT * FROM \"$t\" WHERE id='$id';")
    prod_row=$(sqlite3 "$PROD_DB" "SELECT * FROM \"$t\" WHERE id='$id';")
    if [[ -z "$prod_row" ]]; then
      # 正常情况下不该发生；理论上唯一合理的例外是这条记录在备份之后、
      # 演练比对之前被用户/管理员主动删除了（撤回/清空会话/管理员删动态等），
      # 这个窗口通常只有几秒，命中概率很低，命中了也值得看一眼确认原因。
      fail "$t: id=$id 在恢复库里存在，生产库里查不到了（若确认是备份后被正常删除可忽略，否则要查）"
      DRILL_FAIL=1; MISS=1
    elif [[ "$restored_row" != "$prod_row" ]]; then
      fail "$t: id=$id 内容不一致"
      echo "    恢复库: $restored_row"
      echo "    生产库: $prod_row"
      DRILL_FAIL=1; MISS=1
    fi
  done <<< "$IDS"
  [[ "$MISS" == "0" ]] && ok "$t: 最新 $(echo "$IDS" | grep -c .) 条记录逐一比对一致"
done

echo
echo "════════════════════════════════════════════════"
if [[ "$DRILL_FAIL" == "0" ]]; then
  ok "演练通过：这份备份可以正常恢复，数据一致"
  exit 0
else
  fail "演练失败：见上方标红项，这份备份不能安全信赖"
  exit 1
fi
