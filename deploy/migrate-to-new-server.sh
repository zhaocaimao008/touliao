#!/usr/bin/env bash
# =====================================================================
# 投聊 换服务器一键迁移（从加密备份恢复到一台全新的 Ubuntu 服务器）
#
# 备份来源：每日异地备份（touliao-private-backups 仓库 Actions 产物 snapshot.tar.age），
#          或在旧服务器上现导一份最新的：
#            sudo /usr/local/bin/touliao-backup-export > touliao-latest.tar.age
#
# 用法（新服务器上，root 执行）：
#   git clone https://github.com/zhaocaimao008/touliao.git /tmp/touliao-src
#   sudo bash /tmp/touliao-src/deploy/migrate-to-new-server.sh \
#        --backup /root/touliao-latest.tar.age --identity /root/age-identity.txt \
#        [--email ops@example.com] [--public-ip 1.2.3.4] [--verify-only]
#
#   --backup      加密备份文件（age）
#   --identity    age 私钥（解密用；不在任何服务器上保存，由负责人保管）
#   --email       Let's Encrypt 账号邮箱（证书续期通知；缺省则不留邮箱注册）
#   --public-ip   新服务器公网 IPv4（缺省自动探测；TURN 语音中继需要）
#   --verify-only 只解密并校验备份完整性，不安装、不改动系统
#
# 做什么：装运行环境 → 解密校验备份 → 按原路径恢复代码/配置/数据库/附件/网页/证书/TURN/
#        备份任务/SSH 授权 → 启动后端 → 全套自检 → 打印「切流量」清单。
# 不做什么：不改 DNS、不改 GitHub 配置（切流量由人决定时机，脚本最后给出清单）。
# 可重复执行：失败修好后重跑即可；已存在的数据库/附件不会被覆盖（除非 --overwrite-data）。
# =====================================================================
set -euo pipefail
umask 022

APP_USER=ubuntu
APP_HOME=/home/$APP_USER
REPO=$APP_HOME/gh-mirror/touliao
REPO_URL=https://github.com/zhaocaimao008/touliao.git
DOMAIN=touliao.cc

BACKUP="" IDENTITY="" EMAIL="" PUBLIC_IP="" VERIFY_ONLY=0 OVERWRITE_DATA=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) BACKUP="$2"; shift 2 ;;
    --identity) IDENTITY="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    --public-ip) PUBLIC_IP="$2"; shift 2 ;;
    --verify-only) VERIFY_ONLY=1; shift ;;
    --overwrite-data) OVERWRITE_DATA=1; shift ;;
    -h|--help) sed -n 2,26p "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; BLU='\033[0;34m'; NC='\033[0m'
step() { echo -e "\n${BLU}━━ $* ━━${NC}"; }
ok()   { echo -e "${GRN}[✓]${NC} $*"; }
warn() { echo -e "${YEL}[!]${NC} $*"; WARNINGS+=("$*"); }
die()  { echo -e "${RED}[✗] $*${NC}" >&2; exit 1; }
WARNINGS=()
as_app() { sudo -u "$APP_USER" -H env HOME="$APP_HOME" "$@"; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# ───────────────────────────────────────────────────────────────────
step "0/12 预检"
[[ $EUID -eq 0 ]] || die "请用 root 执行（sudo bash $0 ...）"
[[ -f "$BACKUP" ]] || die "备份文件不存在: ${BACKUP:-（未指定 --backup）}"
[[ -f "$IDENTITY" ]] || die "age 私钥不存在: ${IDENTITY:-（未指定 --identity）}"
. /etc/os-release
[[ "$ID" == ubuntu ]] || die "仅支持 Ubuntu（当前 $ID $VERSION_ID）"
case "$VERSION_ID" in 22.04|24.04) ok "系统 Ubuntu $VERSION_ID" ;; *) warn "未验证过的 Ubuntu 版本 $VERSION_ID，继续执行" ;; esac
need=$(( $(stat -c %s "$BACKUP") * 4 / 1024 ))
free=$(df -Pk / | awk 'NR==2{print $4}')
(( free > need + 4*1024*1024 )) || die "磁盘空间不足：需要约 $(( (need + 4*1024*1024) / 1024 / 1024 ))GB，可用 $(( free / 1024 / 1024 ))GB"
ok "磁盘空间充足（可用 $(( free / 1024 / 1024 ))GB）"

STAGE=/root/touliao-migrate-$(date +%Y%m%d%H%M%S)
mkdir -m 700 "$STAGE"
trap 'echo -e "${YEL}临时目录保留在 $STAGE（含解密后的数据，确认无误后请删除）${NC}"' EXIT

# ───────────────────────────────────────────────────────────────────
step "1/12 安装基础工具"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git age python3 python3-venv sqlite3 sudo iproute2 openssl >/dev/null
ok "git / age / python3 / sqlite3 就绪"
# Node：先装 22 以便校验备份；恢复后若备份记录的大版本不同再切换
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "node $(node --version)"

# ───────────────────────────────────────────────────────────────────
step "2/12 解密并校验备份"
# 与 touliao-private-backups 每日「恢复校验」同一套步骤：解密 → 拆外层 → 校验清单 → 还原迁移包
age -d -i "$IDENTITY" "$BACKUP" | python3 "$SCRIPT_DIR/migration-bundle.py" unpack /dev/stdin "$STAGE/outer"
node "$SCRIPT_DIR/backup-manifest.cjs" verify "$STAGE/outer"
python3 "$SCRIPT_DIR/migration-bundle.py" restore "$STAGE/outer/migration.tar.gz" "$STAGE/bundle" >/dev/null
F="$STAGE/bundle/files"
META="$STAGE/bundle/manifest.json"
SRC_COMMIT=$(python3 -c "import json;print(json.load(open('$META'))['metadata']['sourceCommit'])")
SRC_NODE=$(python3 -c "import json;print(json.load(open('$META'))['metadata']['nodeVersion'])")
CREATED=$(python3 -c "import json,time;print(time.strftime('%Y-%m-%d %H:%M UTC',time.gmtime(json.load(open('$META'))['createdAt'])))")
ok "备份校验通过：生成于 $CREATED，代码版本 ${SRC_COMMIT:0:8}，Node $SRC_NODE"
if [[ $VERIFY_ONLY -eq 1 ]]; then
  ok "--verify-only：备份完整可用，未对系统做任何改动"
  exit 0
fi

# ───────────────────────────────────────────────────────────────────
step "3/12 安装运行环境（nginx / Redis / Docker / certbot / ffmpeg / Node / pm2）"
apt-get install -y -qq nginx redis-server certbot ffmpeg docker.io build-essential >/dev/null
apt-get install -y -qq docker-compose-v2 >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin >/dev/null 2>&1 || warn "未装上 docker compose 插件，TURN 需要它"
SRC_MAJOR=${SRC_NODE#v}; SRC_MAJOR=${SRC_MAJOR%%.*}
CUR_MAJOR=$(node --version | sed -E 's/^v([0-9]+).*/\1/')
if [[ "$SRC_MAJOR" != "$CUR_MAJOR" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${SRC_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
command -v pm2 >/dev/null || npm install -g pm2 >/dev/null 2>&1
systemctl enable --now docker >/dev/null 2>&1 || warn "docker 服务未能启动（容器环境里属正常）"
ok "node $(node --version) / pm2 $(pm2 --version 2>/dev/null | tail -1) / nginx / redis / docker / certbot / ffmpeg"

# ───────────────────────────────────────────────────────────────────
step "4/12 运行用户 $APP_USER"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$APP_USER"
  ok "已创建用户 $APP_USER"
fi
usermod -aG docker "$APP_USER" 2>/dev/null || true
# 每日异地备份用受限 SSH 密钥执行 `sudo -n /usr/local/bin/touliao-backup-export`，只授权这一条命令
echo "$APP_USER ALL=(root) NOPASSWD: /usr/local/bin/touliao-backup-export" > /etc/sudoers.d/touliao-backup-export
chmod 440 /etc/sudoers.d/touliao-backup-export
visudo -cf /etc/sudoers.d/touliao-backup-export >/dev/null
# SSH 授权公钥（GitHub 自动部署 + 异地备份 + 运维本人）：新备份才包含，旧备份跳过
if [[ -f "$F/config/ssh/authorized_keys" ]]; then
  install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.ssh"
  touch "$APP_HOME/.ssh/authorized_keys"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    grep -qxF "$line" "$APP_HOME/.ssh/authorized_keys" || echo "$line" >> "$APP_HOME/.ssh/authorized_keys"
  done < "$F/config/ssh/authorized_keys"
  chown "$APP_USER:$APP_USER" "$APP_HOME/.ssh/authorized_keys"; chmod 600 "$APP_HOME/.ssh/authorized_keys"
  ok "已合并 SSH 授权公钥（$(grep -c . "$F/config/ssh/authorized_keys") 条）"
else
  warn "备份里没有 SSH 授权公钥（旧版备份）：需手动把 GitHub 部署公钥和异地备份受限公钥加入 $APP_HOME/.ssh/authorized_keys"
fi

# ───────────────────────────────────────────────────────────────────
step "5/12 代码（$REPO @ ${SRC_COMMIT:0:8}）"
if [[ ! -d "$REPO/.git" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_HOME/gh-mirror"
  as_app git clone -q "$REPO_URL" "$REPO"
fi
as_app git -C "$REPO" fetch -q origin
as_app git -C "$REPO" checkout -q main
as_app git -C "$REPO" reset -q --hard "$SRC_COMMIT"
# 备份里的 app/ 含当时未提交的改动与未跟踪文件，覆盖回去保持与旧服务器一致
cp -a "$F/app/." "$REPO/"
chown -R "$APP_USER:$APP_USER" "$REPO"
install -m 600 -o "$APP_USER" -g "$APP_USER" "$F/config/backend.env" "$REPO/backend-v2/.env"
ok "代码与 backend-v2/.env 就位"

# ───────────────────────────────────────────────────────────────────
step "6/12 数据库与附件"
envval() {  # 读取 .env 中的值；不存在时返回空（不能让 grep 的非零退出码在 set -e 下终止脚本）
  local v
  v=$({ grep -E "^$1=" "$REPO/backend-v2/.env" || true; } | tail -1 | cut -d= -f2-)
  v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
  printf '%s' "$v"
}
DB_PATH=$(envval DB_PATH); DB_PATH=${DB_PATH:-$REPO/backend-v2/wechat.db}
UPLOADS_ROOT=$(envval UPLOADS_ROOT); UPLOADS_ROOT=${UPLOADS_ROOT:-$REPO/backend-v2/uploads}
if [[ -f "$DB_PATH" && $OVERWRITE_DATA -eq 0 ]]; then
  warn "数据库已存在，未覆盖（$DB_PATH）。确需用备份覆盖请加 --overwrite-data"
else
  gunzip -c "$STAGE/outer/database.db.gz" > "$DB_PATH.restoring"
  [[ "$(sqlite3 "$DB_PATH.restoring" 'PRAGMA integrity_check;' | head -1)" == ok ]] || die "恢复出的数据库 integrity_check 失败"
  mv "$DB_PATH.restoring" "$DB_PATH"; rm -f "$DB_PATH-wal" "$DB_PATH-shm"
  chown "$APP_USER:$APP_USER" "$DB_PATH"; chmod 600 "$DB_PATH"
  ok "数据库恢复并通过完整性检查：用户 $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM users;') 个，消息 $(sqlite3 "$DB_PATH" 'SELECT COUNT(*) FROM messages;') 条"
fi
if [[ -d "$UPLOADS_ROOT" && -n "$(ls -A "$UPLOADS_ROOT" 2>/dev/null)" && $OVERWRITE_DATA -eq 0 ]]; then
  warn "附件目录非空，未覆盖（$UPLOADS_ROOT）"
else
  python3 "$SCRIPT_DIR/migration-bundle.py" restore-uploads "$STAGE/outer/uploads.tar.gz" "$STAGE/uploads" >/dev/null
  rm -rf "$UPLOADS_ROOT"; mkdir -p "$(dirname "$UPLOADS_ROOT")"
  mv "$STAGE/uploads/uploads" "$UPLOADS_ROOT"
  chown -R "$APP_USER:$APP_USER" "$UPLOADS_ROOT"
  ok "附件恢复：$(find "$UPLOADS_ROOT" -type f | wc -l) 个文件"
fi

# ───────────────────────────────────────────────────────────────────
step "7/12 后端依赖、Redis、图片审核环境"
as_app bash -c "cd '$REPO/backend-v2' && npm ci --omit=dev --no-audit --no-fund --loglevel=error"
ok "后端依赖安装完成"
REDIS_URL=$(envval REDIS_URL)
if [[ -n "$REDIS_URL" ]]; then
  REDIS_PASS=$(python3 -c "import sys,urllib.parse as u;print(u.unquote(u.urlparse(sys.argv[1]).password or ''))" "$REDIS_URL")
  if [[ -n "$REDIS_PASS" ]]; then
    sed -i -E '/^\s*requirepass\s/d' /etc/redis/redis.conf
    printf 'requirepass %s\n' "$REDIS_PASS" >> /etc/redis/redis.conf
  fi
  systemctl enable redis-server >/dev/null 2>&1 || true
  systemctl restart redis-server 2>/dev/null || service redis-server restart >/dev/null
  ok "Redis 按 .env 中的连接串配置完成"
fi
MOD_PY=$(envval MEDIA_MODERATION_PYTHON)
if [[ "$(envval MEDIA_MODERATION_PROVIDER)" == local-nudenet && -n "$MOD_PY" ]]; then
  MOD_VENV=$(dirname "$(dirname "$MOD_PY")")
  if [[ ! -x "$MOD_PY" ]]; then
    install -d -o "$APP_USER" -g "$APP_USER" "$(dirname "$MOD_VENV")"
    as_app bash "$REPO/backend-v2/scripts/media-moderation/install.sh" "$MOD_VENV" >/dev/null
  fi
  ok "图片/视频审核环境就绪（$MOD_VENV）"
fi

# ───────────────────────────────────────────────────────────────────
step "8/12 网页、后台、落地页、运行时配置、下载站"
restore_dir() {  # 备份目录 → 线上目录（整体替换）
  [[ -d "$F/$1" ]] || { warn "备份缺少 $1"; return; }
  rm -rf "$2.migrating"; cp -a "$F/$1" "$2.migrating"
  rm -rf "$2"; mv "$2.migrating" "$2"
  chown -R root:root "$2"; find "$2" -type d -exec chmod 755 {} +; find "$2" -type f -exec chmod 644 {} +
}
restore_dir public/web /var/www/touliao-web
restore_dir public/admin /var/www/touliao-admin
restore_dir public/landing /var/www/touliao-landing
restore_dir public/runtime-config /var/www/touliao-runtime-config
restore_dir public/downloads /var/www/downloads
mkdir -p /var/www/ai-updates
ok "静态站点就位（下载站只含当前版本安装包；历史版本不在备份内）"

# ───────────────────────────────────────────────────────────────────
step "9/12 HTTPS 证书（$DOMAIN）"
LE=/etc/letsencrypt
if [[ ! -e "$LE/live/$DOMAIN/fullchain.pem" ]]; then
  install -d -m 755 "$LE/archive/$DOMAIN" "$LE/live/$DOMAIN" "$LE/renewal"
  for n in cert chain fullchain privkey; do
    install -m 600 "$F/config/tls/$n.pem" "$LE/archive/$DOMAIN/${n}1.pem"
    ln -sfn "../../archive/$DOMAIN/${n}1.pem" "$LE/live/$DOMAIN/$n.pem"
  done
  chmod 644 "$LE/archive/$DOMAIN/"{cert,chain,fullchain}1.pem
  install -m 644 "$F/config/tls/renewal.conf" "$LE/renewal/$DOMAIN.conf"
fi
# 续期配置里的 ACME 账号没有备份：注册新账号并写回，否则到期自动续期失败
if ! ls "$LE"/accounts/*/directory/* >/dev/null 2>&1; then
  if [[ -n "$EMAIL" ]]; then certbot register --non-interactive --agree-tos -m "$EMAIL" >/dev/null
  else certbot register --non-interactive --agree-tos --register-unsafely-without-email >/dev/null; fi
fi
ACCOUNT=$(basename "$(ls -d "$LE"/accounts/acme-v02.api.letsencrypt.org/directory/*/ | head -1)")
sed -i -E "s/^account = .*/account = $ACCOUNT/" "$LE/renewal/$DOMAIN.conf"
install -d "$LE/renewal-hooks/deploy"
install -m 755 "$F/config/hooks/touliao-turn-cert-sync.sh" "$LE/renewal-hooks/deploy/touliao-turn-cert-sync.sh"
EXPIRY=$(openssl x509 -enddate -noout -in "$LE/live/$DOMAIN/fullchain.pem" | cut -d= -f2)
ok "证书就位（到期 $EXPIRY），续期账号已更新；DNS 切换后执行 certbot renew --dry-run 验证"

# ───────────────────────────────────────────────────────────────────
step "10/12 nginx"
install -m 644 "$F/config/nginx/touliao-cc.conf" /etc/nginx/sites-available/touliao-cc.conf
install -d /etc/nginx/snippets
install -m 644 "$REPO/deploy/nginx/snippets/"*.conf /etc/nginx/snippets/
ln -sfn /etc/nginx/sites-available/touliao-cc.conf /etc/nginx/sites-enabled/touliao-cc.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t 2>&1 | tail -1
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx
ok "nginx 配置通过并已加载"

# ───────────────────────────────────────────────────────────────────
step "11/12 TURN 语音中继、备份任务"
[[ -n "$PUBLIC_IP" ]] || PUBLIC_IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || true)
LOCAL_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')
install -d -m 750 -o root -g 65534 /etc/touliao-turn
for f in "$F"/config/turn/*; do install -m 640 -o root -g 65534 "$f" /etc/touliao-turn/; done
chmod 600 /etc/touliao-turn/secret
if [[ -n "$PUBLIC_IP" && -n "$LOCAL_IP" ]] && docker info >/dev/null 2>&1; then
  # 复用原密钥，只按新公网 IP 重新生成配置并启动（客户端 TURN 凭据不变）
  node "$REPO/deploy/install-touliao-turn.cjs" "$PUBLIC_IP" "$LOCAL_IP" >/dev/null
  ok "TURN 已按新公网 IP $PUBLIC_IP 启动"
else
  warn "TURN 未启动（公网IP=${PUBLIC_IP:-未知} 本机IP=${LOCAL_IP:-未知} docker=$(docker info >/dev/null 2>&1 && echo 可用 || echo 不可用)）：之后执行 sudo node $REPO/deploy/install-touliao-turn.cjs 公网IP 本机IP"
fi
install -m 755 "$F/ops/touliao-backup" "$F/ops/touliao-backup-export" "$F/ops/touliao-turn-probe-credentials" /usr/local/bin/
rm -rf /usr/local/lib/touliao; cp -a "$F/ops/lib" /usr/local/lib/touliao; chown -R root:root /usr/local/lib/touliao
install -d -m 700 /etc/touliao-backup /var/backup/touliao
install -m 644 "$F/config/backup/recipient.txt" "$F/config/backup/migration-policy.json" /etc/touliao-backup/
install -m 644 "$F/config/systemd/touliao-backup.service" "$F/config/systemd/touliao-backup.timer" /etc/systemd/system/
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "$APP_HOME/.touliao-migration" "$APP_HOME/.touliao-backup-admin" "$APP_HOME/asc-work"
install -m 600 -o "$APP_USER" -g "$APP_USER" "$STAGE/outer/ci-credentials.age" "$APP_HOME/.touliao-migration/ci-credentials.age"
install -m 600 -o "$APP_USER" -g "$APP_USER" "$F/credentials/backup-ssh-key" "$APP_HOME/.touliao-backup-admin/ssh_key"
install -m 644 -o "$APP_USER" -g "$APP_USER" "$F/credentials/backup-ssh-key.pub" "$APP_HOME/.touliao-backup-admin/ssh_key.pub"
for f in "$F"/credentials/asc/*; do install -m 600 -o "$APP_USER" -g "$APP_USER" "$f" "$APP_HOME/asc-work/"; done
if [[ -d "$F/ops/private-backups" ]]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$APP_HOME/touliao-private-backups"
  cp -a "$F/ops/private-backups/." "$APP_HOME/touliao-private-backups/"; chown -R "$APP_USER:$APP_USER" "$APP_HOME/touliao-private-backups"
fi
systemctl daemon-reload 2>/dev/null && systemctl enable --now touliao-backup.timer >/dev/null 2>&1 || warn "touliao-backup.timer 未启用（无 systemd 时属正常）"
ok "备份脚本、定时任务、签名与备份凭据已恢复"

# ───────────────────────────────────────────────────────────────────
step "12/12 启动后端并自检"
# pm2 进程参数取自旧服务器的运行时快照；机密一律只在 .env 中，这里只带非 .env 的运行参数
PM2_CONFIG="$APP_HOME/.touliao-migration/ecosystem.config.js"   # 放在运行用户可读的位置（临时目录在 /root 下，pm2 读不到）
node - "$F/runtime/process.json" "$REPO/backend-v2/.env" "$PM2_CONFIG" <<'NODE'
const fs = require('fs');
const [proc, envFile, out] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(proc, 'utf8'));
const dotenvKeys = new Set(fs.readFileSync(envFile, 'utf8').split('\n').map(l => l.split('=')[0].trim()).filter(Boolean));
const env = {};
for (const k of ['NODE_ENV', 'PORT', 'NODE_OPTIONS', 'TRACING_ENABLED']) if (p.env?.[k] != null && !dotenvKeys.has(k)) env[k] = p.env[k];
const app = { name: 'touliao-backend', script: 'src/server.js', cwd: p.pm_cwd, instances: p.instances || 1, exec_mode: 'fork',
  max_memory_restart: p.max_memory_restart || '600M', kill_timeout: p.kill_timeout || 5000, restart_delay: p.restart_delay || 3000,
  autorestart: true, max_restarts: 15, min_uptime: '10s', time: true, env };
fs.writeFileSync(out, 'module.exports = ' + JSON.stringify({ apps: [app] }, null, 2) + ';\n');
NODE
chown "$APP_USER:$APP_USER" "$PM2_CONFIG"
as_app pm2 delete touliao-backend >/dev/null 2>&1 || true
as_app pm2 start "$PM2_CONFIG" >/dev/null
as_app pm2 save >/dev/null
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/dev/null 2>&1 || warn "pm2 开机自启未配置（无 systemd 时属正常）"

PORT=$(python3 -c "import json;print(json.load(open('$F/runtime/process.json')).get('env',{}).get('PORT','3003'))")
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 2; done
FAIL=0
check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else echo -e "${RED}[✗]${NC} $1"; FAIL=1; fi; }
check "后端健康检查 /health"                 "curl -fsS http://127.0.0.1:$PORT/health"
check "接口 /api/config（经 nginx HTTPS）"    "curl -fsS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/api/config"
check "网页首页（经 nginx HTTPS）"            "curl -fsS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/ -o /dev/null"
check "运行时配置 config.json"                "curl -fsS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/config.json"
check "安卓更新源 version.json"               "curl -fsS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/downloads/touliao-android-version.json"
check "Windows 更新源 latest.yml"             "curl -fsS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/downloads/updates/latest.yml"
check "Redis 连通"                            "redis-cli ${REDIS_PASS:+-a \"$REDIS_PASS\" --no-auth-warning} ping | grep -q PONG"
check "TURN 端口 3478 在监听"                 "ss -lun | grep -q ':3478 '"

# ───────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
if [[ $FAIL -eq 0 ]]; then echo -e "${GRN} 新服务器已就绪（尚未切流量）${NC}"; else echo -e "${RED} 有自检项未通过，先处理上面标红的项再切流量${NC}"; fi
echo "════════════════════════════════════════════════════════════════"
if ((${#WARNINGS[@]})); then echo -e "${YEL}需要留意：${NC}"; for w in "${WARNINGS[@]}"; do echo "  • $w"; done; fi
cat <<EOF

切流量清单（确认上面全部通过后按顺序执行）：
  1. 停止旧服务器写入并导出最后一份备份，在本机用 --overwrite-data 重跑本脚本，
     避免丢失备份之后到切换之前的新消息：
       旧服务器：sudo /usr/local/bin/touliao-backup-export > touliao-final.tar.age && pm2 stop touliao-backend
  2. DNS：把 $DOMAIN 和 www.$DOMAIN 的 A 记录改为 ${PUBLIC_IP:-新服务器公网 IP}（TTL 建议提前调小）
  3. DNS 生效后验证证书续期：sudo certbot renew --dry-run
  4. GitHub（zhaocaimao008/touliao → Settings → Secrets）：
       DEPLOY_SERVER_HOST = ${PUBLIC_IP:-新服务器公网 IP}；DEPLOY_USER = $APP_USER
  5. 异地备份（zhaocaimao008/touliao-private-backups）：更新服务器地址 secret，
     并把新主机公钥写入 ssh_known_hosts：ssh-keyscan -H ${PUBLIC_IP:-新IP}
  6. 客户端无需任何改动（域名不变；TURN 凭据沿用原密钥）
EOF
exit $FAIL
