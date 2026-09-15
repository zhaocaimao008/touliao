# 投聊迁移备份与恢复

2026-09-15。本文针对迁移现有投聊生产实例，不是新建空白实例。
保留 `touliao.cc` 域名时通常不需要重新发布客户端；改域名、用户手动指定旧地址等情况需另行检查。

## 已纳入备份

每日 GitHub Actions 在 UTC 03:00（北京时间 11:00）加密托管发布凭据，UTC 03:15（北京时间 11:15）拉取完整快照。
时间是计划触发时间，不保证准点。私有仓库 `zhaocaimao008/touliao-private-backups` 仅保留外层 age 密文 Artifact，保留期 30 天。
原有服务器本地数据库、上传目录备份定时器继续运行，不替换成迁移包。

- SQLite 在线备份及上传附件，检查所有业务表行数、完整性、外键和归档 SHA-256。
- 后端完整 `.env`，包括现有 JWT、管理员、推送、TURN 配置；仅记录投聊的 PM2 进程配置。
- 专用 TURN 配置、共享密钥、TLS 文件、续期同步钩子及容器启动源码。
- 投聊域名 Nginx 配置、HTTPS 证书/私钥和续期配置。证书符号链接仅可解析到该域名的证书目录。
- 当前 Git 工作区源码，包括未提交及未忽略的新增文件、依赖锁文件；记录提交号及脏工作区状态，不归档 `.git` 历史或 `node_modules`。
- 线上 Web、管理端、介绍页、运行时 `config.json`/`directory.json`。
- 当前 Windows 安装包、更新清单/签名/blockmap、下载别名，以及当前 Android APK/版本清单。相同文件去重，不保留历代安装包。
- 18 项现有 GitHub 发布/部署凭据：Android 签名库及密码、iOS 证书/描述文件/ASC 密钥、Windows 更新 Ed25519 私钥、部署 SSH 和个推配置。
- 专用备份 SSH 密钥、公钥、本机 ASC P8、备份脚本、定时器和私有备份工作流。

完整采集白名单见 `deploy/migration-policy.json`，生产安装位置是 `/etc/touliao-backup/migration-policy.json`。
凭据密文超过 48 小时、必需文件缺失、安装包哈希/更新签名不匹配等情况直接失败，不报告部分成功。
主代码仓库是公开仓库，任何密钥、明文归档及恢复目录均不得提交；凭据工作流只向服务器传送密文，不上传公开 Artifact。

## 隔离恢复

在可信机器上准备 Node.js 22、Python 3.10+、age、sqlite3、tar、OpenSSL 3、JDK/keytool 和 apksigner。
校验工具应取自可信代码仓库的 `deploy/` 或私有备份仓库，先不要运行归档中的脚本。
下载一次成功运行的 `snapshot.tar.age`，准备独立保管的 age 私钥文件；不要把私钥写在命令行参数或日志里。

```bash
set -euo pipefail
umask 077
RESTORE=$(mktemp -d /tmp/touliao-restore-XXXXXX)
IDENTITY=/secure/offline/identity.txt
SNAPSHOT=/secure/download/snapshot.tar.age
age -d -i "$IDENTITY" "$SNAPSHOT" | python3 deploy/migration-bundle.py unpack /dev/stdin "$RESTORE/snapshot"
node deploy/backup-manifest.cjs verify "$RESTORE/snapshot"
python3 deploy/migration-bundle.py restore "$RESTORE/snapshot/migration.tar.gz" "$RESTORE/migration"
python3 deploy/migration-bundle.py restore-uploads "$RESTORE/snapshot/uploads.tar.gz" "$RESTORE/attachments"
age -d -i "$IDENTITY" "$RESTORE/snapshot/ci-credentials.age" | node deploy/credential-escrow.cjs verify-materials /dev/stdin "$RESTORE/migration/files/app/desktop-electron/src/update-public-key.pem" "$RESTORE/migration/files/public/downloads/touliao-android-latest.apk"
gzip -dc "$RESTORE/snapshot/database.db.gz" > "$RESTORE/database.db"
sqlite3 "$RESTORE/database.db" 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
```

目标目录必须不存在；校验拒绝路径越界、归档链接、重复成员和额外外层文件，不会自动覆盖生产目录。
文件恢复到 `migration/files/{app,config,runtime,public,credentials,ops}`，具体源路径和权限见恢复目录的 `manifest.json`。
恢复区保持 0700，敏感文件不输出到终端；结束后安全清理明文工作区。SSD/云盘上删除文件不等同物理擦除，应使用可信临时加密磁盘。

签名验证实际导入 Android 私钥并比对线上 APK 的证书指纹，核对 iOS P12 私钥与证书、描述文件身份，验证更新 Ed25519 私钥与应用公钥一致。
这不等于重新构建四端，也不能证明远端 Apple/个推等账号未撤销；证书到期日会输出，后续仍需正常续期。

## 真正切换服务器时

1. 先在新机隔离恢复，安装与快照兼容的 Node、PM2、Nginx、Docker Compose；按锁文件安装依赖。源码包含旧机未提交改动，不要用 `git reset` 覆盖。
2. 按清单还原数据库、附件、静态站点及原 `.env`；调整机器路径、属主和目录权限。不要对现有实例直接执行 `setup-new-server.sh`，它会生成新 JWT/管理员配置。
3. `.env` 和数据库保留原身份密钥。参考 `runtime/process.json` 重建投聊进程，不导入包含其他项目的全局 PM2 dump。先绑定本地地址测试。
4. TURN 保留共享密钥，改成新公网/内网 IP；恢复 `/etc/touliao-turn` 后使用专用安装器重新配置。运行容器的 UID/GID 为 65534，证书和配置需要对应只读权限。重新放行 UDP/TCP 3478、TCP 5349、UDP 49160-49200；Nginx 开放 TCP 80/443，SSH 限制管理来源。
5. HTTPS 证书可暂时恢复用于同一域名，新机仍须建立自己的 ACME 账号并重新申请/配置续期及 TURN 同步钩子。备份没有其他域名的 ACME 账号；旧续期配置不能盲目照搬。
6. 重建受限备份 SSH 公钥的强制导出命令及禁用转发限制，安装 `ops/` 的备份工具和定时器，更新迁移白名单路径。不要复制旧服务器整份 `authorized_keys` 或全局 sudoers。
7. 更新 GitHub 的部署主机/用户和必要的 SSH 密钥授权，更新主仓库 `deploy/ssh_known_hosts` 与私有备份仓库的 `ssh_known_hosts`。核对新主机指纹，不关闭 StrictHostKeyChecking。域名不变也会更换 SSH 主机密钥。
8. 先暂停旧机写入，取最后一份完整快照并校验/同步到新机，再切 DNS A/AAAA、负载均衡或相关源站配置。数据库、附件和配置是顺序快照，不能当作跨文件事务；禁止新旧两机同时独立接收写入。
9. 检查 HTTPS、健康接口、登录/头像/消息/附件、WebSocket 重连、运行时 JSON、更新清单及签名，再从外网验证 TURN UDP/TCP/TLS 和真实通话、移动推送。DNS 缓存及已建立连接不保证立即切换，留出维护窗口。
10. 切换成功后手动跑凭据托管和完整备份工作流；保留旧机只读回滚窗口。新机已产生数据时不能直接切回旧库，否则会丢新数据。

线上 Nginx 快照还含共享机器的 `/ai-updates/` 路由，但不包含该其他项目的文件；新机不承载它时应移除该路由。

## 边界与必须独立保管的材料

- age 解密根私钥不放进它自己加密的备份。当前在旧机受限目录和私有备份仓库 Secret 中，必须再有独立离线/密码管理器副本；旧机与 GitHub 账号同时丢失不能靠本方案自救。
- 域名注册商、云平台账号/MFA、云防火墙规则与外部服务权限不能由本机文件备份替代，迁移时仍需这些账号。
- Windows 发布者证书尚未配置。现有 Ed25519 更新签名已纳入备份，但它不是 Authenticode 发布者证书；未来硬件/云签名证书需单独安排恢复权限。
- 不备份其他项目、全局 SSH/PM2/云平台凭据、历史安装包和依赖缓存。完整源码不等于完全离线可构建。
- GitHub Artifact 不是不可变存储，也没有异云容灾 SLA。30 天每日完整快照约需数 GB 存储，留意额度和失败通知；不要删除最后可恢复副本。
- 当前只在本机隔离目录和 GitHub 临时 runner 验证恢复，没有新服务器实机切换演练。上线新机的操作应按上节单独执行。
