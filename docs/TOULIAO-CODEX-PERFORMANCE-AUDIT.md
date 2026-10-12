# 投聊性能与资源审计

## 结论

整体 63/100，`PARTIAL`。已有消息虚拟化、分页、批量 reply/reaction 查询、广播合并、超大房间轻通知、上传分片和静态资源压缩；但存在可复现 listener/open-handle 问题及协议级大群缺口。

## 运行证据

- Backend Jest：146.979 秒，69 suites / 562 tests；多次 `MaxListenersExceededWarning`，`error`/`online` listener 累加到 Worker，最后靠 `--forceExit`。
- 主机内存 15 GiB，采样时 used 8.0 GiB、available 7.2 GiB；Swap 8 GiB 中使用 6.3 GiB。单点采样不能证明当前内存压力来源，禁止以重启代替分析。
- Web build：核心 `ChatWindow` gzip 约 38 KB、`Home` 约 33 KB；PDF worker 原始约 1.26 MB，XLSX 约 430 KB，PDF 约 469 KB，DOCX 约 173 KB，已经按 chunk 懒加载但首次预览成本明显。
- 可再生依赖目录体积：backend 447 MB、web 426 MB、Electron 467 MB；Electron dist 235 MB。

## 风险

1. 测试模块重载会反复创建 DB Worker；writer 只有发 shutdown 消息，没有可 await 的 terminate/清理契约，导致 listener 警告和 open handles。
2. `activeCalls`、广播 pending/timer、限流 Map 都是进程内状态；多实例和重启语义不稳定。
3. 大群 notify 的客户端支持不一致，性能降级路径在 iOS 变成功能丢失。
4. 增量查询 limit 100/300 无统一续页，峰值时不是“慢”，而是截断。
5. 生产库外键关闭且有大量孤儿，查询 INNER JOIN 会隐藏数据；迁移/备份恢复后结果可能进一步漂移。

## 复核状态（2026-10-12）

| 风险 | 状态 | 证据 |
| --- | --- | --- |
| 1. DB Worker listener / open handle | 已解决 | `writer.shutdown()` 返回 Promise，等 Worker 真正 `exit` 后 resolve（480d4539）；Jest `setupFilesAfterEnv` 统一 teardown 已加载的 writer（f3784741、23dc5881），`test/db-writer-lifecycle.test.js` 覆盖。全量 Jest 181 suites / 1659 tests，`MaxListenersExceededWarning` 0 次，未加 `--forceExit` 也能自行退出（唯一失败为 p1-07 typing 限流计时用例，与此项无关）。 |
| 2. 进程内状态 | 未处理 | 本次未涉及。 |
| 3. 大群 notify 客户端不一致 | 未处理 | 本次未涉及。 |
| 4. 增量查询截断 | 已解决 | 四端断线补拉走 `GET /messages/:conversationId/sync`：`server_sequence` cursor + `has_more`，单页上限 500（`sync.service.js`），Web/Android/iOS 均处理续页。遗留的 `GET /messages/missed` 无客户端调用方，上限 1000；命中上限时返回 `X-Missed-Truncated: 1` 与 `X-Missed-Next-After`，截断点所在那一秒整体留到下一页，用该值作 `after` 续拉不丢不重（`test/missed-truncation.test.js`）。响应体仍为数组。 |
| 5. 外键关闭 / 孤儿数据 | 已解决 | 主连接（`db/connection.js`）与写 Worker（`db/worker.js`）启动时均 `PRAGMA foreign_keys = ON`；31 张表声明了外键。对生产库只读快照执行 `PRAGMA foreign_key_check` 为 0 行；messages→users/conversations、conversation_members→users/conversations、conversation_events/message_deliveries/message_reactions→messages 手工核查孤儿均为 0。读路径的 `sender_id` INNER JOIN 已改为 LEFT JOIN + COALESCE（480d4539）。 |

## 建议验证

- 用 `--detectOpenHandles`、heap snapshot 和 Worker 数量曲线定位 Jest/生产生命周期；不要提高 listener 上限掩盖。
- 24 小时 soak：每端连接/断开、快速切换会话、循环播放视频/语音、反复通话，记录 RSS、heap、fd、timer、socket、MediaStream。
- 100/1,000/10,000 会话与每会话 10,000 消息基准；记录 p50/p95/p99、event-loop delay、SQLite busy、写队列深度。
- 按进程采集 `smem`/RSS/Swap/PSS 与历史趋势，确认 6.3 GiB Swap 的归属后再制定修复。
