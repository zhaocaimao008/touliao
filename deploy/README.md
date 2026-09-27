# 投聊 部署指南（换服务器免配置）

## 换服务器：一键迁移（推荐，唯一入口）

**思路**：新服务器 = 装环境 + 用每日加密备份恢复。备份里已有代码、`.env`、数据库、附件、网页/后台/落地页、
下载站、nginx、HTTPS 证书、TURN、备份任务、SSH 授权公钥与各类凭据；脚本按原路径放回并自检。

**准备**
- 一台全新 Ubuntu 22.04 / 24.04（有 `ubuntu` 用户或允许脚本创建），开放 22 / 80 / 443 / 3478 / 5349 端口
- 最新备份：旧服务器上现导一份（最完整）
  `sudo /usr/local/bin/touliao-backup-export > touliao-latest.tar.age`
  或从 `touliao-private-backups` 仓库 Actions 下载最近一次 `snapshot.tar.age`
- age 解密私钥（负责人保管，不在任何服务器上）

**执行（新服务器上）**
```bash
git clone https://github.com/zhaocaimao008/touliao.git /tmp/touliao-src
# 可先只校验备份、不改系统：
sudo bash /tmp/touliao-src/deploy/migrate-to-new-server.sh --backup /root/touliao-latest.tar.age --identity /root/age.key --verify-only
# 正式迁移：
sudo bash /tmp/touliao-src/deploy/migrate-to-new-server.sh --backup /root/touliao-latest.tar.age --identity /root/age.key --email 你的邮箱
```

脚本 12 步：预检 → 装工具 → 解密校验（与异地备份每日恢复校验同一流程）→ 装 nginx/Redis/Docker/certbot/ffmpeg/Node/pm2
→ 运行用户与 SSH 授权 → 代码（切到备份时的提交并带上未提交改动）→ 数据库（integrity_check）与附件
→ 后端依赖、Redis 密码、图片审核环境 → 静态站点 → 证书（注册新 ACME 账号写回续期配置）→ nginx
→ TURN（沿用原密钥、按新公网 IP 生成配置）与备份任务 → 启动后端并自检，最后打印**切流量清单**。

- **只装不切**：脚本不改 DNS、不改 GitHub 配置；自检全部通过后按清单切换
- **可重复执行**：中途失败修好后重跑；已有数据库/附件不覆盖，切换前用最后一份备份加 `--overwrite-data` 重跑
- **客户端无需改动**：域名不变；TURN 凭据沿用原密钥
- 已在全新 Ubuntu 24.04 容器中用合成备份完整演练（容器无 Docker 时 TURN 一项会提示未启动，属正常）

> 旧的 `setup.sh` / `bootstrap-server.sh` / `setup-new-server.sh` 已废弃（目录布局与线上不一致），默认拒绝执行。

## 为什么能"免配置"

| 端 | 机制 | 换服务器要做的 |
|----|------|----------------|
| **Web** | `VITE_API_BASE` 留空 → 全部相对路径，靠 nginx 转发 | 零改动，nginx 由脚本生成 |
| **桌面端** | 设置里可切换服务器（electron-store 持久化） | 用户在设置里填新域名即可，无需重装 |
| **移动端** | 登录页可切换服务器（AsyncStorage 持久化） | 用户在 App 内填新域名即可，无需重新打包 |

## 重新部署 / 更新代码

```bash
cd /root/touliao && git pull && ./deploy/setup.sh chat.example.com
```
脚本幂等：已存在的 `.env` 和密钥会被保留，不会重置用户登录态。

## 已有生产环境的日常更新（手动，不走 setup.sh）

> 2026-08-30 补充。此前这份文档只写了"全新部署"和"重新跑 setup.sh"两种场景，没有覆盖
> "生产环境已经在跑，只想手动更新后端或Web这一步该用什么命令"——这个空白导致过一次
> 真实事故：手动用 `rsync -a --delete` 同步Web构建产物到线上目录时，把混放在同一目录下、
> 不属于构建产物的运行时配置文件 `config.json` 误删了（详见 `AUDIT.md` 二十一节）。

**后端**：
```bash
cd /root/touliao && git pull
cd backend-v2 && npm install   # 只要 package.json/package-lock.json 有变化就跑一遍，无害
pm2 restart touliao-backend --update-env
pm2 logs touliao-backend --lines 50   # 确认无启动报错
curl -s http://127.0.0.1:3003/health   # 确认 {"ok":true,...}
```

**Web**：
```bash
cd /root/touliao/web && npm run build

# 先备份当前线上版本（延续既有惯例，命名 .bak-YYYYMMDD-HHMMSS）
cp -r /var/www/touliao-web "/var/www/touliao-web.bak-$(date +%Y%m%d-%H%M%S)"

# 同步构建产物——⚠️ 用 -a，不要加 --delete 直接对整个目录做全量同步，
# 除非你已经确认目录里没有混放任何非构建产物的文件
rsync -a /root/touliao/web/dist/ /var/www/touliao-web/

nginx -t && nginx -s reload
curl -s -o /dev/null -w "%{http_code}\n" https://touliao.cc/
```

### 旧哈希资产的清理（2026-09-04 补充）

上面那条 `rsync -a`（不带 `--delete`）只增不减：每次构建产生新的哈希文件名，旧的永远留在
`/var/www/touliao-web/assets/` 里。2026-09-04 实测已累积 650 个文件 13M，而当前构建只需 113 个。

不要因此就改用 `--delete`——除了上面那次 `config.json` 事故，还有第二个原因：Web 是 Vite
懒加载分包，用户浏览器里已经打开的上一版页面仍会按旧 `index.html` 去取旧 chunk。`assets` 的
`Cache-Control` 是 `public, immutable` 一年，`index.html` 是 `no-store`，但已经渲染出来的页面
不会重新取 HTML。立刻删掉旧 chunk，那些页面点开对应功能就会 404 白屏。

改用 `ops/prune-web-assets.sh`，它按「当前构建引用闭环 + 宽限期」清理：

```bash
/root/touliao/ops/prune-web-assets.sh              # dry-run，只报告（默认）
/root/touliao/ops/prune-web-assets.sh --apply      # 真删，删前自动 tar 备份到 backups/
GRACE_HOURS=48 /root/touliao/ops/prune-web-assets.sh --apply   # 放宽宽限期
```

从 `index.html` / `privacy.html` 出发递归解析 chunk 互引，得到当前构建真正可达的资产（含各自
`.gz`）全部保留；闭环外但 mtime 在宽限期（默认 24h）内的也保留；其余删除。解析不出任何引用、
或闭环内文件在磁盘上缺失时直接报错退出，不会误删。`deploy.yml` 的发布步骤已在 rsync 之后自动
调用它（失败不阻断部署）；上面的手动流程只在不走 CI 时才需要自己跑。

**`config.json`（运行时远程配置，四端启动都会拉取）现在单独存放，不在Web构建产物目录里**：
```
物理路径：/var/www/touliao-runtime-config/config.json
公开URL： https://touliao.cc/config.json（nginx alias 指到上面那个物理路径，URL本身没变）
```
**为什么不放在 `/var/www/touliao-web/` 里**：那个目录是 `web/dist/` 构建产物的镜像，理论上应该能被
`rsync -a --delete` 安全地整体同步替换；`config.json` 是运维单独维护、不随每次构建变化的运行时文件，
混在同一个目录里会让"构建产物目录"和"运行时配置目录"的边界不清晰，`--delete` 语义和这种混合目录
天然冲突——这正是2026-08-30那次事故的根因。**以后如果要新增其它运行时配置文件（不是构建产物的），
放进 `/var/www/touliao-runtime-config/`，不要放回Web构建产物目录**，并在nginx里单独配一个
`location` 指过去。

## nginx 配置纳入版本控制

> 2026-08-30 补充。此前 nginx 配置只存在于生产服务器本机，不受版本控制——服务器重装/
> 迁移时没有权威依据能照着重建，也没有历史改动记录。现在在仓库里保留一份副本。

**线上真实配置**：`/etc/nginx/conf.d/touliao-cc.conf`（这台服务器上唯一真正被nginx加载、
在用的touliao配置文件；同目录下如果看到`*.bak-*`结尾的文件，那些是历史备份，不是在用的）。

**仓库副本**：`deploy/nginx/touliao-cc.conf`。用途是**参考和灾难恢复**（服务器重装/换新
服务器时，照这份文件在新机器上重建nginx配置），**不是**运行时直接依赖的文件——nginx
读的是`/etc/nginx/conf.d/`下的真实文件，不会去读仓库里的这份副本。

**⚠️ 这两份文件不会自动保持一致，靠人工纪律维持**：修改线上nginx配置后，必须手动把
改动同步到仓库副本并提交，否则仓库里的版本会逐渐过期、失去"灾难恢复依据"这个价值。
（技术上可以用符号链接让两者天然同步，评估过这个方案但暂未采用——`rm`线上配置文件、
建符号链接这类系统级操作的自动化审批门槛较高，这次改为纯文档约定，之后如果需要
升级成符号链接方案，再单独执行。）

**改nginx配置的标准流程**：
```bash
# 1. 改线上真实配置
vim /etc/nginx/conf.d/touliao-cc.conf

# 2. 语法检查
nginx -t

# 3. 确认无误后 reload（不是restart，reload不中断现有连接）
nginx -s reload

# 4. 验证改动生效（按改了什么针对性验证，比如新增了一个location就curl测一下）

# 5. 手动同步一份到仓库并提交——这一步最容易忘，务必执行
cp /etc/nginx/conf.d/touliao-cc.conf /root/touliao/deploy/nginx/touliao-cc.conf
cd /root/touliao && git add deploy/nginx/touliao-cc.conf && git commit -m "说明这次改了什么、为什么"
```

## 关键环境变量（脚本自动写入，一般无需手改）

| 变量 | 说明 | 默认/自动 |
|------|------|-----------|
| `PORT` | 后端端口 | 3002 |
| `DB_PATH` | SQLite 路径 | `backend-v2/wechat.db` |
| `UPLOADS_ROOT` | 上传文件目录 | `backend-v2/uploads` |
| `JWT_SECRET` | 登录令牌密钥 | 自动随机生成 |
| `CORS_ORIGINS` | 额外允许的跨域来源 | 自动填入你的域名 |
| `REDIS_URL` | 留空则自动降级内存模式 | 可选 |
