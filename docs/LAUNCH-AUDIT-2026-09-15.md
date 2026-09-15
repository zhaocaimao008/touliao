# 投聊上线审查（2026-09-15）

## 结论

暂不建议将当前 Windows、Web、Android、iOS 整体作为已验收的正式版本公开上线。
本次发现并修复了可复现的权限、推送归属、文件解析和备份问题；后端/Web 安全补丁可以在回归和健康检查通过后单独发布。
这不是“没有 bug”的保证，也不是四端真机验收报告。发布结果和最终测试数字在本文件末尾记录。

审查基线：`b343f40624801b3b13a01efaa481c79adefe4782`，线上 Backend 8.0.1 / Web 8.1.19 / Windows 8.1.21。
补丁版本：Backend 8.0.2 / Web 8.1.22。Windows 和手机安装包不包含本次前端依赖修补，需要后续重新构建和验收。
审查使用独立工作树、临时 SQLite、临时上传目录；未对生产账号发送攻击负载，未修改真实聊天内容。
原工作区未提交的 Android/iOS 多开改动保持原样，不混入本次安全补丁。

## 已修复的问题

| 级别 | 问题及实际影响 | 修复及证据 |
| --- | --- | --- |
| P1 | Express 固定信任两跳代理，直接访问 Nginx 的客户端可伪造来源 IP，影响限流和管理员 IP 白名单。 | `backend-v2/src/app.js` 仅信任 loopback；Nginx 对 API、Socket、uploads 覆盖代理头。白名单 IP 伪造回归由放行变为 403。 |
| P1 | 管理员停用、删除或降权后，旧 JWT 仍可继续操作后台和读取上传文件。 | `utils/adminAuthorization.js` 根据当前数据库状态授权，后台和媒体共用；保留配置中的根管理员及其旧格式凭证兼容。 |
| P1 | 同一 APNs/FCM/个推 token 或 Web Push endpoint 可同时归属不同账号，切号时旧账号通知可能继续发到当前设备。 | 推送注册事务内转移归属，全局唯一索引；迁移撤销无法确定归属的重复订阅，需活动客户端重新注册。迁移前生产重复数为 0，不需撤销现有订阅。延迟旧账号注销不会删除新归属。 |
| P1 | 辅助 ACK 接口允许非会话成员伪造送达/已读和查询回执；批量接口缺少权限、类型和条数校验。 | `utils/messageAuthorization.js` 查询真实会话成员；整批先校验再写入，上限 500；已读落库前再次校验。 |
| P1 | 普通用户可查看死信队列内容、全局 ACK 统计，并触发全局缓存预热/刷新；监控数据和 Web Vitals 最近记录保护不足。 | 这些运维接口只接受管理员认证；用户缓存预热仅限本人；普通批次响应不再泄露全局用户统计。 |
| P1 | `file-type` 16.5.4 解析 55 字节畸形 ASF 文件会无限循环，占满后端事件循环。 | 隔离子进程复现超时；升级到 21.3.4，覆盖 ASF 和 ZIP 解压资源耗尽修补。合法图像/音频/文档仍走完整回归。 |
| P1 | Multer 1.x 命中恶意 multipart 字段导致崩溃、CPU 耗尽等公告。 | 升级 2.4.0，限制字段数量、大小、嵌套层数和数组下标；异常大数组下标回归返回 400。 |
| P1 | 预览联系人发送的表格会调用存在原型污染/ReDoS 公告的 `xlsx` 0.18.5；渲染后的 HTML 清洗不能修复解析器缺陷。 | 从 SheetJS 官方 CDN 安装 0.20.3，锁文件保留完整性摘要；真实浏览器验证上传、接收、多工作表切换、HTML 清洗和手机视口。 |
| P1 | 未安装定时备份；旧脚本吞掉 tar 失败后报告成功，备份文件权限过宽。 | 备份加互斥锁、私有权限和临时目录；数据库解压完整性验证、附件归档验证全部成功后才发布文件；失败非零退出。新增每日 systemd timer。 |
| P2 | 管理员退出没有等待凭证撤销持久化；存储失败时仍可能报告成功。 | 等待黑名单写入，失败返回错误；故障注入回归和正常退出失效回归通过。 |
| P2 | ACK 正在写 Redis 时新到的回执可能被旧批次完成操作误删。 | flush 前移走旧批次，新回执拥有独立待处理批次；延迟 Redis 的竞态测试覆盖。 |
| P2 | 登录、注册、改密、注销和管理员登录的部分凭证参数缺少严格类型检查，错误 JSON 可触发 500。 | 在数据库/bcrypt 前拒绝非字符串；兼容原有正常密码策略。 |
| P2 | 公网 `/health` 实际返回 SPA HTML，监控只看 HTTP 200 会漏报后端故障。 | Nginx 增加精确健康路由并禁止缓存，代理到真实数据库健康检查。 |

兼容性变化：`/api/reliability/{dlq,queue/stats}`、`/api/optimization/{stats,ack/flush,cache/warm}`、`/api/monitoring/*` 和 `/api/metrics/vitals/recent` 现在要求管理员 Cookie。仓库四端普通业务流程没有调用这些运维接口。

## 仍阻挡整体验收的项目

1. **Windows 内核不受支持。** 现有 8.1.21 使用 Electron 30.5.1；官方只维护最近三个稳定大版本。应先升级受支持的 Electron 和构建链，再重跑多开、登录、媒体、更新和真实 Windows 安装验收。现有 CI 使用 Node 20，而当前受支持的新 Electron npm 包要求 Node >=22.12.0，需要同步调整构建环境，不能只改版本号。
2. **没有 TURN 中继配置。** 生产环境未配置 `TURN_URLS`/`TURN_SECRET`，通话只有 STUN 路径。不能保证移动网络、跨运营商和对称 NAT 场景连通；需要投聊专用中继及真实外网 relay 分配/双向媒体验证。本次没有借用其他项目的 TURN 密钥。
3. **手机真机闭环未验收。** 未完成 Android/iOS 多实例安装、切号后推送隔离、杀后台来电、锁屏接听和 Wi-Fi/蜂窝切换。Linux 环境没有 Xcode、Android SDK 或连接手机，静态检查不等于原生构建/真机验收。已有推送密钥仅说明配置存在，不证明真实到达。
4. **Windows 发布者签名缺失。** 实际安装器和 touliao.exe 没有 Authenticode 签名；Ed25519 更新签名有效不等于 Windows 可信发布者签名，可能仍有 SmartScreen/未知发布者提示。
5. **备份仍只在本机。** 每日数据库/附件快照不能防整机磁盘丢失，需要独立存储的加密异地副本和告警闭环。数据库与附件不是统一文件系统时间点快照，活跃上传/删除期间应安排维护窗口或补充一致性恢复演练。

## 其他残余风险

- React Router 6.30.6 仍命中两个 moderate 公告；本项目是客户端 SPA，没有 SSR hydration，当前登录跳转来自本地 router state，但仍建议升级维护分支并约束所有动态跳转为本站路径。
- 后端剩余 moderate 依赖主要来自 Firebase/Google Cloud SDK、旧 OTel Resource 和 uuid。当前 Firebase 未配置、OTel 无 collector 默认不启动，项目使用 uuid v4；不应将所有构建/未启用路径告警误报为已复现的远程漏洞，也不能忽略后续升级。
- 桌面构建依赖仍有 high/critical 公告，需与 Electron 升级一起处理；不能只看 Web 的扫描结果判定安装包安全。
- `rateLimiters.js` 在 Redis 异步连接完成前创建 store，当前单进程内存限流有效，但不能据“Redis connected”日志宣称已通过多进程共享限流验收。扩容前需要修正初始化时序并做两实例实测。
- 浏览器切换桌面/手机布局断点会重新挂载聊天视图，已打开的文件预览会关闭。移动预览流程本身已测试；跨断点保留模态状态属于未处理的体验问题。
- 覆盖率门禁低于全面覆盖；未做长时间容量压测、第三方推送实际投递、真实资金通道或异地灾备接管测试。

## 安全公告依据

- [Express 可信代理说明](https://expressjs.com/en/guide/behind-proxies/)
- [file-type ASF 无限循环](https://github.com/sindresorhus/file-type/security/advisories/GHSA-5v7r-6r5c-r473)
- [file-type ZIP 解压资源耗尽](https://github.com/sindresorhus/file-type/security/advisories/GHSA-j47w-4g3g-c36v)
- [Multer 数组下标拒绝服务](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4)
- [Multer 2.4.0 中断上传清理修补](https://github.com/expressjs/multer/security/advisories/GHSA-3pph-fpjx-jg34)
- [SheetJS 官方安装版本](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)
- [Electron 版本维护政策](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)

## 验证与发布记录

完整测试及发布后检查进行中；发布完成后补齐本节。原始回归报告保存在服务器私有目录 `/home/ubuntu/touliao-launch-audit-evidence-20260915`，不包含生产凭证。
