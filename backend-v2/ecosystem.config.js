// PM2 部署配置 —— v信 后端 v2
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
      name: 'vxin-server-v2',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '600M',   // 2GB 小机防 OOM：超限自动重启
      autorestart: true,
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 3000,  // 崩溃后等 3s 再重启，避免数据库未完全关闭
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: '3002',
      },
      error_file: '/root/.pm2/logs/vxin-server-v2-error.log',
      out_file: '/root/.pm2/logs/vxin-server-v2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
