# 投聊上线阻断项修复记录

本记录承接 `LAUNCH-AUDIT-2026-09-15.md`。基线为 `85418fe9`。
这是一份修复与验证记录，不代表四端已无缺陷或已完成全部真机验收。

## 已发布

- 2026-09-15 13:04 UTC 发布 Backend 8.0.3 / Web 8.1.23，13:29 UTC 将后端更新至 8.0.4；公网为 https://touliao.cc。
- Windows 8.1.23 已发布，Electron 43.7.0；安装包、更新清单、签名、差分文件和两个固定下载别名均已完成公网内容校验。
- 仅重启 `touliao-backend`，最终 PID 525692；另外三个 PM2 服务 PID 未变。
- 数据库升级前后：13 个用户、107 条消息、11 个会话、16 个登录会话，数量一致。
- 154 条迁移，数据库完整性通过，外键错误为 0；`.env`、DB、WAL、SHM 权限均为 600。
- 撤销 4 个设备 token 和 1 个旧 Web Push 订阅：历史数据没有登录会话绑定，不能猜测应归属哪个会话。客户端重新打开并完成注册后恢复通知，消息和账号未删除。
- 公网健康接口返回真实 JSON，`db=ok`，禁止缓存。首页、入口资源和两个 Service Worker 与已测试构建的 SHA-256 一致。
- 公网 1440x900 / 390x844 登录页通过真实浏览器检查：没有页面脚本异常、裂图或横向溢出。
- 原主工作区 8 个移动多开相关未提交文件 SHA-256 与修改前逐项一致，没有覆盖或混入本次提交。

## 修复内容

1. 后端、Web、桌面三个完整依赖树均已消除本次扫描发现的漏洞。React Router、Vitest、OTel Resource、uuid、Electron 构建链更新；OTel 使用新版 Resource API。没有为消除告警直接升级不兼容的 Firebase 14。
2. Capacitor 原生桥仍保持 4.x。新版 tar 的 CJS 导出与旧 CLI 不兼容，安装时实施严格匹配的导入兼容补丁；实际 Android 模板生成、解包、资源同步通过，CI 已纳入该检查。
3. 每个 Web 账号、登录会话、独立窗口使用不同的推送 Service Worker scope。消息强制带实际接收人；点击通知只路由给匹配窗口，关闭后的独立窗口需重新认证，不能误投到当前其他账号。
4. 推送目的地保持全局唯一归属，并绑定经过认证的登录会话。注销、踢出会话、改密后通过外键级联撤销相关订阅；旧会话延迟注销不能删除新归属。旧无会话 JWT 不能注册或批量移除新订阅。
5. 移除 Android FCM 的五分钟旧 token 归属缓存，发送时查询当前归属。通知已经交给外部服务后的投递无法撤回，不能据此承诺所有在途消息都可取消。
6. 修复 Redis 限流初始化竞态。配置共享存储后，冷启动等待连接；故障返回 503，不静默退回每进程计数器。无 Redis 配置时仍使用原有单进程内存模式。未启用横向扩容，Socket.IO 仍需单独验证多实例适配。
7. 退出接口不再吞掉会话删除失败；故障返回错误，避免报告已退出而推送会话仍保留。会话删除和两种推送注册改用 SQLite `IMMEDIATE` 事务，避免读取后的并发写入使事务升级报 `SQLITE_BUSY`；新增双连接确定性回归测试。修复本地测试固定 `/tmp` 数据库污染问题，环境门禁测试改用每例独立临时目录。
8. 未配置云存储时直接回退本地上传，不再无意义地重试三次。登录后的返回路径仅允许本站地址。
9. 文件预览提升到桌面/手机布局分支上方，跨断点保留工作表；预览同时绑定账号上下文，切号不显示前一账号文件。

## 验证

- [最终业务修复 CI](https://github.com/zhaocaimao008/touliao/actions/runs/34974208093)：源码 `124dba27`，四项全部成功。Backend 111 个套件、870 项通过、1 项跳过；Web 33 个套件、240 项通过；ESLint、迁移只追加、Capacitor 版本和实际同步检查通过。
- 三个完整依赖树 `npm audit` 均为 0。OTel 不仅校验导入，还实际初始化并向本地临时 gRPC collector 导出 span 成功；未启用生产遥测。
- 后端共享限流专项使用两个独立 Node HTTP 进程和真实临时 Redis，验证冷启动共享额度、故障拒绝和恢复。
- 三账号真实浏览器回归：独立身份和 Socket、刷新保持、单窗退出、双向聊天、头像上传与加载、XLSX 多工作表预览和跨布局断点保持均通过。三个独立推送注册并存，退出一窗只移除自己的订阅。
- 上述浏览器推送网关使用明确标注的替身；不能把订阅与路由测试当作 FCM、APNs、个推实际投递验收。
- 桌面 profile 8 项单测、TURN 协议 5 项单测、备份 3 项故障及恢复测试、TURN shell 合约测试通过。
- 生产数据库副本先执行真实升级演练，验证完整性、外键、结构漂移及业务数量，再发布。
- 最终后端发布后再次检查公网健康、生产数据库完整性和外键、业务行数及敏感文件权限；本机备份在 13:32 UTC 实际恢复校验通过。

## 异地备份

- 新建用户所属的私有仓库 [touliao-private-backups](https://github.com/zhaocaimao008/touliao-private-backups)，没有向公开源码仓库上传数据库或附件。
- 生产服务器先使用 age 加密，再由受限 SSH key 拉取。该 key 强制执行固定导出程序，不能执行任意命令、打开终端或端口转发。用它请求 `id`，实际仍只得到加密归档，已验证。
- 每日 03:15 UTC 执行，密文保留 30 天；临时 runner 解密验证后删除明文和临时密钥。校验所有 56 张表的行数、SQLite 完整性、外键和两个归档 SHA-256。
- [首次远端恢复](https://github.com/zhaocaimao008/touliao-private-backups/actions/runs/34970970910)、[8.0.3 发布后恢复](https://github.com/zhaocaimao008/touliao-private-backups/actions/runs/34972812315)及[最终 8.0.4 发布后恢复](https://github.com/zhaocaimao008/touliao-private-backups/actions/runs/34975657169)均成功；还下载前两次远端产物到服务器，实际解密复验通过。
- 原本机每日备份 timer 保持启用。GitHub 失败会保留失败运行并使用账号的 Actions 通知设置；未验证用户的邮件或消息通知实际到达。排程延迟、配额、GitHub 账号丢失仍需运维监控，不是不可变存储或跨供应商灾备 SLA。
- 恢复密钥和专用 SSH key 在服务器私有目录 `/home/ubuntu/.touliao-backup-admin`，权限 600；还需由运维保留独立离线恢复密钥。数据库和附件为顺序快照，不是同一文件系统事务。

## TURN 阻断

- 投聊独立 coturn 已部署；不复用其他项目的容器、密钥或中继端口。配置包含短期 HMAC 凭据、有效 TLS 证书、私网 peer 限制及资源配额，证书续期 hook 仅重启投聊容器。
- 本机 UDP/TCP 有效凭据分配成功、无效凭据被拒绝；TLS 1.3 证书严格验证通过。
- [外网探测](https://github.com/zhaocaimao008/touliao/actions/runs/34971253081)三个入口全部超时。服务器角色调用 Lightsail 管理 API 返回 AccessDenied，没有防火墙管理权限。
- 必须在投聊实例的云防火墙放行 TCP/UDP 3478、TCP 5349、UDP 41000-41999，然后重新运行 `TURN External Verification`，通过外网分配、拒绝伪造凭据及 relay-only 双向音视频验证。
- `/etc/touliao-turn/backend.env` 仅为私有待启用配置，没有写入生产后端。因此目前仍不能承诺受限 NAT/跨运营商通话可达。

## Windows 与手机

- [Windows 8.1.23 构建、安装及发布](https://github.com/zhaocaimao008/touliao/actions/runs/34974402477)成功；版本标签 `desktop-v8.1.23` 对应 `fef62a46`，其 Web 和桌面源码与最终后端 CI 提交相同。
- Windows runner 上实际安装 NSIS 包，通过系统 ShellExecute 连续启动安装器生成的桌面快捷方式 6 次，无调试参数，确认 6 个原生窗口和正确的已安装进程路径。Playwright 再验证 6 个独立实例、并发启动、隐藏首窗不抢占、独立 userData/sessionData/localStorage、关闭后复用原 profile、登录图标加载。保留 Windows 原生 sandbox。
- 实际发布检查发现 SSH 消耗上传循环 stdin，造成清单漏传，而原 HTTP 200 检查漏报。已补齐与发布包匹配的签名和清单；循环增加 `ssh -n`，发布门禁改成 6 个公网文件与已验证产物逐字节比对。实际执行工作流脚本回归通过，包含模拟 stdin 消耗、故意旧清单必须失败、正确产物通过。
- 更新清单通过 Ed25519 验签，安装包的长度和 SHA-512 与清单一致；公网安装包、两个固定下载别名、清单、签名和 blockmap 与实际发布构建全部一致。部署先上传临时文件再替换，清单最后发布；SSH 固定主机公钥。
- [Windows 安装包](https://touliao.cc/downloads/touliao-windows-latest.exe)：108787154 字节；SHA-256 `b4c2078601a0a01c5cd44f397e4482bf7b467ee82a936475597139a7599371bd`。测试构建未发布，不与正式构建混用。
- 缺少真实 Authenticode 发布者证书。Ed25519 更新签名不等于 Windows 发布者签名，不能消除未知发布者或 SmartScreen 提示。
- Android/iOS 原生多实例、杀后台通知、锁屏接听、网络切换尚无真机验收；原有移动多开改动保持用户原样。本次未发布新的 Android/iOS 安装包。

原始证据、截图和私有回滚文件位于 `/home/ubuntu/touliao-launch-fixes-evidence-20260915`，不要提交或公开该目录。
