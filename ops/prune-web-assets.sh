#!/usr/bin/env bash
###############################################################################
# prune-web-assets.sh — 清理 /var/www/touliao-web/assets/ 里的陈旧哈希资产
#
# 背景：deploy.yml 的发布步骤用 `rsync -a` 不带 --delete（沿用 deploy/README.md
# "确认目录纯净前不要 --delete" 的保守约定），因此每次部署的新哈希文件只增不减。
# 2026-09-04 实测已累积 650 个文件，而当前构建只需 113 个。
#
# 为什么不直接加 --delete：Web 是 Vite 懒加载分包，用户浏览器里可能仍持有上一版
# index.html（其 Cache-Control 是 no-store，但已打开的页面不会重新取）。一旦把旧
# chunk 立刻删掉，那些页面点开对应功能就会 404 白屏。所以本脚本采用
# 「当前构建引用闭环 + 宽限期」策略，而不是无条件对齐。
#
# 保留规则：
#   1. 从 index.html / privacy.html 出发，递归解析 chunk 之间的相互引用，
#      得到当前构建真正可达的全部资产（含各自的 .gz）——一律保留；
#   2. 闭环外但 mtime 在宽限期内（默认 24h）的——保留，给旧页面留缓冲；
#   3. 其余全部删除，删前先打 tar 备份。
#
# 用法：
#   ./ops/prune-web-assets.sh                 # dry-run，只报告不改动（默认）
#   ./ops/prune-web-assets.sh --apply         # 真正删除（先自动备份）
#   GRACE_HOURS=48 ./ops/prune-web-assets.sh --apply
###############################################################################
set -euo pipefail

WEB_ROOT="${WEB_ROOT:-/var/www/touliao-web}"
GRACE_HOURS="${GRACE_HOURS:-24}"
BACKUP_DIR="${BACKUP_DIR:-/root/touliao/backups}"
APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

[ -d "$WEB_ROOT/assets" ] || { echo "❌ 找不到 $WEB_ROOT/assets"; exit 1; }

LIST=$(mktemp); trap 'rm -f "$LIST"' EXIT

WEB_ROOT="$WEB_ROOT" GRACE_HOURS="$GRACE_HOURS" LIST="$LIST" python3 - <<'PY'
import os, re, time, sys
root = os.environ['WEB_ROOT']
A = os.path.join(root, 'assets')
grace = float(os.environ['GRACE_HOURS']) * 3600

seeds = set()
for page in ('index.html', 'privacy.html'):
    p = os.path.join(root, page)
    if os.path.exists(p):
        s = open(p, encoding='utf-8', errors='ignore').read()
        for m in re.findall(r'assets/[A-Za-z0-9._-]+\.(?:js|css|mjs)', s):
            seeds.add(m.split('/')[-1])
if not seeds:
    sys.exit('❌ index.html 未解析出任何资产引用，拒绝继续（避免误删全部）')

seen, q = set(), list(seeds)
while q:
    f = q.pop()
    if f in seen:
        continue
    seen.add(f)
    fp = os.path.join(A, f)
    if not os.path.exists(fp):
        continue
    try:
        s = open(fp, encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    for m in re.findall(r'["\'\(/]([A-Za-z0-9._-]+\.(?:js|css|mjs))["\'\)]', s):
        if os.path.exists(os.path.join(A, m)) and m not in seen:
            q.append(m)

missing = [f for f in seen if not os.path.exists(os.path.join(A, f))]
if missing:
    sys.exit('❌ 当前构建引用的资产在磁盘上缺失，先查部署完整性：%s' % missing[:5])

keep = set()
for f in seen:
    keep.add(f)
    if os.path.exists(os.path.join(A, f + '.gz')):
        keep.add(f + '.gz')

now = time.time()
allf = os.listdir(A)
grace_keep, delete = [], []
for f in allf:
    if f in keep:
        continue
    (grace_keep if now - os.path.getmtime(os.path.join(A, f)) < grace else delete).append(f)

mb = lambda L: sum(os.path.getsize(os.path.join(A, x)) for x in L) / 1048576
print('闭环内保留 : %4d 个  %6.1f MB' % (len(keep), mb(list(keep))))
print('宽限期保留 : %4d 个  %6.1f MB  (mtime < %sh)' % (len(grace_keep), mb(grace_keep), os.environ['GRACE_HOURS']))
print('可删除     : %4d 个  %6.1f MB' % (len(delete), mb(delete)))
print('目录合计   : %4d 个  %6.1f MB' % (len(allf), mb(allf)))
open(os.environ['LIST'], 'w').write('\n'.join(sorted(delete)))
PY

COUNT=$(grep -c . "$LIST" || true)
if [ "$COUNT" -eq 0 ]; then echo "✅ 没有需要清理的文件"; exit 0; fi

if [ "$APPLY" -eq 0 ]; then
  echo
  echo "— dry-run，未改动任何文件。加 --apply 执行 —"
  echo "样例:"; head -5 "$LIST" | sed 's/^/    /'
  exit 0
fi

TS=$(date -u +%Y%m%dT%H%M%SZ)
BK="$BACKUP_DIR/web-assets-prune-$TS"
mkdir -p "$BK"
tar -czf "$BK/stale-assets.tar.gz" -C "$WEB_ROOT/assets" -T "$LIST"
cp "$LIST" "$BK/deleted-file-list.txt"
echo "✅ 已备份 $COUNT 个文件 → $BK/stale-assets.tar.gz ($(du -h "$BK/stale-assets.tar.gz" | cut -f1))"

(cd "$WEB_ROOT/assets" && xargs -a "$LIST" -r rm -f)
echo "✅ 已删除 $COUNT 个陈旧资产"
echo "删后: $(find "$WEB_ROOT/assets" -type f | wc -l) 个文件  $(du -sh "$WEB_ROOT/assets" | cut -f1)"

echo "— 验活 —"
curl -sS -o /dev/null -w "  首页        HTTP %{http_code}\n" --resolve touliao.cc:443:127.0.0.1 https://touliao.cc/ --max-time 15 || true
B=$(curl -sS --resolve touliao.cc:443:127.0.0.1 https://touliao.cc/ --max-time 15 2>/dev/null | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
[ -n "$B" ] && curl -sS -o /dev/null -w "  入口 bundle HTTP %{http_code}\n" --resolve touliao.cc:443:127.0.0.1 "https://touliao.cc/$B" --max-time 20 || true
echo "  回滚: tar -xzf $BK/stale-assets.tar.gz -C $WEB_ROOT/assets"
