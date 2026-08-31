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

## 建议验证

- 用 `--detectOpenHandles`、heap snapshot 和 Worker 数量曲线定位 Jest/生产生命周期；不要提高 listener 上限掩盖。
- 24 小时 soak：每端连接/断开、快速切换会话、循环播放视频/语音、反复通话，记录 RSS、heap、fd、timer、socket、MediaStream。
- 100/1,000/10,000 会话与每会话 10,000 消息基准；记录 p50/p95/p99、event-loop delay、SQLite busy、写队列深度。
- 按进程采集 `smem`/RSS/Swap/PSS 与历史趋势，确认 6.3 GiB Swap 的归属后再制定修复。
