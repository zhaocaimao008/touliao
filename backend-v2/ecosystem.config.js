// PM2 部署配置 —— 投聊 后端 v2
//
// ⚠️ 2026-10-11 核对：生产进程此前一直是手工 `pm2 start src/server.js --name touliao-backend`
//   起的，并没有从本文件启动——kill_timeout 实际是 pm2 默认的 1600ms（pm2.log 里大量
//   "still alive after 1600ms, sending SIGKILL"），NODE_OPTIONS / TRACING_ENABLED 都没生效，
//   max_memory_restart 1G 是当天手工补上的。本文件已按线上实际校准（进程名、日志路径、
//   内存阈值不变），只补上缺的安全项。切换步骤（用 ubuntu 用户执行，不要 sudo，否则会起到
//   root 的 pm2 守护进程里；会断线几秒，挑低峰）：
//     1) 先看线上启动日志确认是 `http://127.0.0.1:3003  (env=production)`——下方 env 会覆盖
//        .env 里的同名变量（dotenv 不覆盖已存在的环境变量；.env 里若有 PORT_V2 则仍以它为准）
//     2) pm2 delete touliao-backend && pm2 start ecosystem.config.js --only touliao-backend && pm2 save
//     3) pm2 describe touliao-backend 核对 kill_timeout / max memory restart / 日志路径
//   以后改本文件要重新 delete + start 才生效（按进程名 pm2 restart 不会重读本文件）；
//   不要再用 pm2 start src/server.js，否则又会悄悄丢掉这里的配置。
//
// 方案 B：单实例 fork 模式。
// 原因：Socket.IO 未接共享适配器(Redis)，多实例(cluster)会导致跨实例的
//       实时消息/通知投递不到对端。单实例可保证投递一致；目标 1000 条 WebSocket
//       长连接，单进程（单核）足够承载。主机为 4 核 / 15GB，与其他 node 应用共用
//       （2026-10 约 40 活跃用户，稳态 RSS 约 205MB）。
// 若将来要恢复多实例：先装 Redis 并在 server.js 接 @socket.io/redis-adapter，
//       再把 instances 改回 'max' / 2、exec_mode 改回 'cluster'。
module.exports = {
  apps: [
    {
      name: 'touliao-backend',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      // 防 OOM：RSS 超限由 pm2 走正常停止流程（SIGINT → 优雅退出）重启。
      // 2026-10-11：与线上手工设置的 1G 保持一致（原 600M）。阈值宁高勿低——每次内存重启
      // 都会断开全部 WebSocket、引发一轮重连风暴；1G 相对稳态 RSS 余量充足，又能在泄漏时
      // 把它圈住，不至于拖着共用主机进 swap。pm2 约每 30s 采样一次 RSS。
      max_memory_restart: '1G',
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 3000,  // 崩溃后等 3s 再重启，避免数据库未完全关闭
      // pm2 stop/restart 先发 SIGINT，等满 kill_timeout 仍未退出才 SIGKILL。
      // 2026-10-11：server.js 的 graceful() 自带 1200ms 硬上限，正常约 1.2s 内自行 exit，
      // 所以这里调大不会拉长重启时间；5000 只是给事件循环被同步任务卡住、兜底定时器来不及
      // 触发的情况留余量，避免 writer worker 还在 flush 时被 SIGKILL 掐断。
      kill_timeout: 5000,
      // V8 GC 参数经 NODE_OPTIONS 传递：由 node 自身在启动时读取，不依赖 pm2 怎么拼 argv
      // （历史上遇到过 fork 模式下 node_args 不生效）。
      env: {
        NODE_ENV: 'production',
        PORT: '3003',
        NODE_OPTIONS: '--max-old-space-size=1024 --max-semi-space-size=32',
        // --max-old-space-size=1024: 老生代上限 1GB。不设时 V8 按物理内存推算，15GB 主机上约 4GB，
        //   GC 可以拖得更久、泄漏时先把共用主机拖进 swap。与 max_memory_restart '1G' 的关系：
        //   RSS = 堆 + 新生代 + 代码区 + SQLite 页缓存/Buffer 等堆外内存，通常先于老生代触顶，
        //   所以正常由 pm2 内存重启（优雅退出）先接管；V8 堆上限只兜 pm2 两次采样之间的突发
        //   暴涨——那时是 V8 OOM 直接崩溃（不走优雅退出），再由 autorestart 拉起。
        // --max-semi-space-size=32: 调大新生代半空间（MB）。scavenge（minor GC）次数更少，
        //   短命对象（消息体、socket 包）更少被过早晋升进老生代，减轻老生代 GC 压力。
        // 本机无 OTLP collector，禁用避免启动卡死（2026-08-20 修复）。
        // tracing.js 现在没配 OTEL_EXPORTER_OTLP_ENDPOINT 也会跳过，这里保留作双保险。
        TRACING_ENABLED: 'false',
      },
      // 2026-10-11：日志路径对齐线上现有文件（即 pm2 对 touliao-backend 的默认路径），
      // 切换后既有的 grep / 日志轮转无需改。原值 /root/.pm2/logs/touliao-server-v2-*.log
      // 是旧部署遗留，ubuntu 用户的 pm2 无权写入。
      error_file: '/home/ubuntu/.pm2/logs/touliao-backend-error.log',
      out_file: '/home/ubuntu/.pm2/logs/touliao-backend-out.log',
      // 必须保留：不合并时 pm2 会给日志文件名追加 -<pm_id>（如 touliao-backend-out-0.log），
      // 与上面的线上路径对不上。
      merge_logs: true,
      // 2026-10-11：原为 true。线上从未开启——winston 输出已自带 [HH:mm:ss]，再叠一层 pm2
      // 时间戳会改变现有日志格式、打断按行首匹配的 grep。保持与线上一致；要开请单独评估。
      time: false,
    },
  ],
};
