# 投聊安全审计

## 结论

总体 70/100，`PARTIAL`，不满足正式发布候选。后端在消息、群成员、附件注册表、撤回、通话信令和 TURN 凭据上已有较明确的服务端权限边界；主要阻断来自生产数据关系漂移、依赖风险、部署破坏性操作和未完成的运行态越权矩阵。

## 已确认的正向控制

- JWT 明确限制 HS256，并校验 token blacklist/用户状态。
- `/uploads` 先认证，再按 `file_registry` 原始会话或服务端 share 表授权；不信客户端伪造 message 引用。
- 文件下载使用短期资源 ticket，普通 JWT 不直接写入长期 URL。
- 群消息、群管理、撤回/个人删除在服务端检查 member/role/owner。
- TURN 客户端只获取 HMAC 时效凭据，源码未发现把长期 secret 直接下发客户端。
- SQL 主路径使用参数化查询；上传有类型、大小和 nosniff 控制。

## 风险

- P1：生产 `file_registry` 有 16 个不存在 owner、1 个不存在 conversation；授权与迁移结果不可预测。修复前必须备份并逐条分类。
- P1：部署 workflow 在生产使用 `git reset --hard`，违反项目禁令。CI 获得生产 SSH 权限后，错误提交的破坏面较大。
- P2：`npm ci` 报 11 个 moderate；含弃用的 `multer@1.4.5-lts.2`。需保存 `npm audit --json` 并逐 CVE 评估，不能直接 force fix。
- P2：受限环境中的在线 `npm audit` 首次 DNS 失败；本报告只采用安装阶段返回的数量，不虚构漏洞明细。
- P2：版本库包含 Firebase 客户端配置文件。其 API key 通常是客户端标识而非服务端秘密，但仍应在 Firebase 控制台限制包名、SHA、域名与 API 范围。
- P2：`/uploads` 允许 token query 是媒体标签兼容方案；虽然资源 ticket 10 分钟过期，仍需确保 nginx/access log 不记录 query 或做脱敏。
- P2：管理员、附件 Range、群踢出后旧 ticket、撤回他人消息等虽有单测，未完成真实多账号黑盒全矩阵。

## 越权测试矩阵状态

| 场景 | 状态 |
|---|---|
| 普通用户读他人私聊 | `CI_PASS`（IDOR 单测） |
| 下载他人附件 | `CI_PASS`（registry IDOR 单测）；生产孤儿数据 `PARTIAL` |
| 撤回他人消息 | `CI_PASS` |
| 普通成员踢人/管理群 | `CI_PASS` |
| 被踢后收新消息/查历史 | `CODE_PASS`，跨 socket 运行态 `PARTIAL` |
| 管理员 API | `CODE_PASS`，独立黑盒矩阵 `PARTIAL` |
| TURN 匿名 relay | 配置文件未读取生产实例；`REAL_DEVICE_REQUIRED`/运维检查 required |

## 发布前安全门禁

1. 停止生产 `reset --hard` 部署，改不可变 release 目录 + 原子 symlink + 数据目录外置。
2. 生产库备份后，在副本演练孤儿修复，保留已注销用户的匿名 tombstone 以避免历史消息消失。
3. 逐项处理 11 个 moderate，特别是上传链依赖；升级需单独回归文件类型/大小/分片/权限。
4. 对所有 `.env`、私钥、TURN secret、CI secret 做历史扫描与轮换证明；报告中不输出值。
5. 强制 relay 真机验证确认匿名 relay 关闭、客户端无长期 secret、TURNS 证书链有效。
