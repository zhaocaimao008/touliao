/**
 * Playwright 全局 setup:
 *  1. 起隔离 backend-v2(3099) + 造测试账号(写 .e2e-state.json 供 spec 读)
 *  2. 起一个静态服务器 serve web/dist(WEB_URL),供 web project 访问
 * 句柄存到 global,teardown 关闭。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startBackend } = require('../shared/backend/fixture');
const { seedUsers, uniquePhone, befriendAndOpenConv } = require('../shared/backend/seed');
const env = require('../shared/env');

const STATE_FILE = path.join(__dirname, '..', '.e2e-state.json');
const WEB_DIST = path.join(env.REPO_ROOT, 'web', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function startStaticServer(dir, port, { backendUrl, uploadsToken } = {}) {
  const backend = backendUrl ? new URL(backendUrl) : null;
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rawPath = req.url.split('?')[0];
      // 生产环境 nginx 与 web 同源、把 /uploads、/downloads 反代到后端；E2E 里 web(静态)
      // 与后端分处不同端口，纯 web 模式下 mediaUrl 返回相对路径 <img src="/uploads/…">
      // 会打到本静态服务器、SPA 回退成 index.html(HTML) 导致图片解码失败。这里补上反代，
      // 复刻生产拓扑。<img> 无法带鉴权头，故注入一个种子用户的 Bearer(后端 /uploads 仅校验
      // 签名有效+未拉黑、不校验文件归属，任意有效 token 即可取任意 upload)。
      if (backend && (rawPath.startsWith('/uploads') || rawPath.startsWith('/downloads'))) {
        const proxyReq = http.request({
          hostname: backend.hostname,
          port: backend.port,
          path: req.url,
          method: req.method,
          headers: {
            ...req.headers,
            host: backend.host,
            ...(uploadsToken ? { authorization: `Bearer ${uploadsToken}` } : {}),
          },
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on('error', () => { res.writeHead(502); res.end('proxy error'); });
        req.pipe(proxyReq);
        return;
      }

      let p = decodeURIComponent(rawPath);
      if (p === '/') p = '/index.html';
      let file = path.join(dir, p);
      // SPA 回退:非静态资源(无后缀)走 index.html
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(dir, 'index.html');
      }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    const url = new URL(port ? `http://127.0.0.1:${port}` : env.WEB_URL);
    server.listen(Number(url.port), '127.0.0.1', () => resolve(server));
  });
}

module.exports = async () => {
  // 1. 后端
  const backend = await startBackend({ fresh: true });
  global.__E2E_BACKEND__ = backend;

  // 2. 造号:userA/userB(单聊双方) + 一个备用
  const users = await seedUsers([
    { username: 'AliceE2E', phone: uniquePhone() },
    { username: 'BobE2E', phone: uniquePhone() },
    { username: 'CarolE2E', phone: uniquePhone() },
  ]);
  // A↔B 互为好友 + 建私聊会话(CHAT 用例直接用 convId)
  let convAB = null;
  try { convAB = await befriendAndOpenConv(users[0], users[1]); }
  catch (e) { console.warn('[e2e] 建好友/会话失败(CHAT用例可能跳过):', e.message); }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ users, convAB, backendUrl: env.BACKEND_URL }, null, 2));

  // 3. 生成大文件 fixture(9MB,>8MB 触发分片上传用例 EDGE-01)
  const bigfilePath = path.join(__dirname, '..', 'fixtures', 'bigfile.txt');
  if (!fs.existsSync(bigfilePath)) {
    fs.writeFileSync(bigfilePath, Buffer.alloc(9 * 1024 * 1024, 65)); // 9MB 'A'
    console.log('[e2e] 生成 fixtures/bigfile.txt (9MB)');
  }

  // 4. 静态 web(仅 web project 需要;electron 用 dist 直接 loadFile,不依赖此)
  if (fs.existsSync(WEB_DIST)) {
    const webUrl = new URL(env.WEB_URL);
    global.__E2E_WEB__ = await startStaticServer(WEB_DIST, webUrl.port, {
      backendUrl: env.BACKEND_URL,
      uploadsToken: users[0]?.token,   // /uploads 反代注入(见 startStaticServer 注释)
    });
    console.log(`[e2e] web 静态服务 ${env.WEB_URL}`);
  } else {
    console.warn(`[e2e] 未找到 web/dist,web project 将失败。先运行 npm run build:web`);
  }
  console.log(`[e2e] 后端就绪 ${env.BACKEND_URL},已造号 ${users.length} 个`);
};
