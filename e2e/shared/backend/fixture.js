/**
 * 起/停隔离的 backend-v2 测试实例(独立 DB + 测试端口 + 固定邀请码)。
 * 不碰线上,不污染开发数据库。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const env = require('../env');

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url + '/health', (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

/** 启动后端,轮询 /health 直到就绪。返回 { proc, stop() }。 */
async function startBackend({ fresh = true } = {}) {
  if (fresh) { try { fs.unlinkSync(env.DB_PATH); } catch {} }

  const proc = spawn('node', ['src/server.js'], {
    cwd: env.BACKEND_DIR,
    env: {
      ...process.env,
      DB_PATH: env.DB_PATH,
      PORT_V2: String(env.BACKEND_PORT),
      INVITE_CODE: env.INVITE_CODE,
      JWT_SECRET: env.JWT_SECRET,
      APP_URL: env.BACKEND_URL,
      NODE_ENV: 'test',
      DISABLE_RATE_LIMIT: '1',   // e2e:关限流,批量造号/发消息不被挡
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });

  // 轮询就绪(最多 ~20s)
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await ping(env.BACKEND_URL)) {
      return {
        proc,
        stop: () => new Promise((res) => {
          proc.once('exit', () => res());
          proc.kill('SIGTERM');
          setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} res(); }, 3000);
        }),
      };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  try { proc.kill('SIGKILL'); } catch {}
  throw new Error(`backend 未在 20s 内就绪。日志:\n${log.slice(-2000)}`);
}

module.exports = { startBackend, ping };
