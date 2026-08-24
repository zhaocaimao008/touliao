// PM2 部署配置 —— 投聊 后端 v2
//
// 方案 B：单实例 fork 模式。
// 原因：Socket.IO 未接共享适配器(Redis)，多实例(cluster)会导致跨实例的
//       实时消息/通知投递不到对端。单实例可保证 1000 人同时在线时投递一致；
//       2 核 / 2GB 小机上，1000 条 WebSocket 长连接单核 + 单进程完全够用。
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
      max_memory_restart: '600M',   // 防 OOM：超限自动重启
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 3000,  // 崩溃后等 3s 再重启，避免数据库未完全关闭
      kill_timeout: 5000,
      // V8 GC 优化（经 NODE_OPTIONS 传递，PM2 fork 模式 node_args 不生效的已知问题）
      env: {
        NODE_ENV: 'production',
        PORT: '3003',
        NODE_OPTIONS: '--max-old-space-size=1024 --max-semi-space-size=32',
        // --max-old-space-size=1024: 老生代上限 1GB（对齐 max_memory_restart 600M 的缓冲，
        //   避免 V8 默认 4GB 堆在 16G 机器上 GC 停顿过大；600M 触发重启前有充分余量）
        // --max-semi-space-size=32: 新生代 32MB（短生命周期对象多，提升 minor GC 频率降低延迟尖峰）
        TRACING_ENABLED: 'false',  // 本机无 OTLP collector，禁用避免启动卡死（2026-08-20 修复）
      },
      error_file: '/root/.pm2/logs/touliao-server-v2-error.log',
      out_file: '/root/.pm2/logs/touliao-server-v2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
