'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Server } = require('socket.io');
const { io: client } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const realtime = require('../src/realtime');
const presence = require('../src/realtime/presence');
let server, io, nginx, dir, proxyUrl, directUrl, middleware;
const token = jwt.sign({ id: 'f01-user' }, config.jwtSecret, { expiresIn: '1h' });
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });

function connect(url, source, headers = {}) {
  return new Promise(resolve => {
    const socket = client(url, { transports: ['websocket'], reconnection: false, timeout: 2000,
      auth: { token }, extraHeaders: headers, transportOptions: { websocket: { localAddress: source } } });
    socket.once('connect', () => { socket.close(); resolve('ok'); });
    socket.once('connect_error', error => { socket.close(); resolve(error.message); });
  });
}
beforeAll(async () => {
  db.prepare('INSERT INTO users(id,username,phone,password) VALUES (?,?,?,?)').run('f01-user', 'f01-user', 'f01-phone', 'synthetic');
  server = http.createServer();
  io = new Server(server);
  // Exercise the production middleware, without unrelated online/push side effects.
  const middlewares = [];
  realtime({ use: fn => { middlewares.push(fn); io.use(fn); }, on() {} });
  middleware = middlewares[0];
  await listen(server);
  directUrl = `http://127.0.0.1:${server.address().port}`;
  const reserve = http.createServer();
  await listen(reserve);
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  proxyUrl = `http://127.0.0.1:${port}`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-f01-'));
  const conf = path.join(dir, 'nginx.conf');
  fs.writeFileSync(conf, `pid ${dir}/nginx.pid;
error_log ${dir}/error.log;
events { worker_connections 256; }
http { access_log off; server { listen 127.0.0.1:${port}; location /socket.io/ {
proxy_pass ${directUrl}; proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";
proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $remote_addr;
} } }`);
  nginx = spawn('/usr/sbin/nginx', ['-p', dir, '-c', conf, '-g', 'daemon off;'], { stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    const ready = await new Promise(resolve => {
      const req = http.get(proxyUrl, res => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false));
    });
    if (ready) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('isolated nginx failed to start');
});
beforeEach(() => { realtime._resetIpHandshake(); });
afterAll(async () => {
  if (nginx && nginx.exitCode == null) { const exited = new Promise(resolve => nginx.once('exit', resolve)); nginx.kill('SIGTERM'); await exited; }
  if (io) await new Promise(resolve => io.close(resolve));
  await require('../src/db/writer').shutdown();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('31 concurrent clients with distinct source IPs connect through real nginx', async () => {
  const results = await Promise.all(Array.from({ length: 31 }, (_, i) => connect(proxyUrl, `127.0.0.${i + 2}`)));
  expect(results.filter(result => result === 'ok')).toHaveLength(31);
});
test('same source: first 30 succeed, 31st reconnect is rate limited despite spoofed headers', async () => {
  const results = [];
  for (let i = 0; i < 31; i++) results.push(await connect(proxyUrl, '127.0.0.2', { 'X-Real-IP': `192.0.2.${i + 1}`, 'X-Forwarded-For': `198.51.100.${i + 1}` }));
  expect(results.slice(0, 30)).toEqual(Array(30).fill('ok'));
  expect(results[30]).toMatch(/连接过于频繁/);
});
test('direct untrusted TCP peer cannot rotate X-Real-IP to bypass the limit', async () => {
  const results = [];
  for (let i = 0; i < 31; i++) results.push(await connect(directUrl, '127.0.0.2', { 'X-Real-IP': `192.0.2.${i + 1}` }));
  expect(results[30]).toMatch(/连接过于频繁/);
});
test('IPv6 spellings and IPv4-mapped IPv6 share a canonical quota', async () => {
  const attempt = ip => new Promise(resolve => middleware({ handshake: { address: '::ffff:127.0.0.1', headers: { 'x-real-ip': ip }, auth: {} } }, error => resolve(error?.message)));
  for (let i = 0; i < 30; i++) expect(await attempt(i % 2 ? '2001:db8::1' : '2001:0db8:0:0:0:0:0:1')).toBe('未授权');
  expect(await attempt('2001:db8::1')).toMatch(/连接过于频繁/);
  // A second actual address must have its own quota.
  expect(await attempt('192.0.2.1')).toBe('未授权');
  for (let i = 0; i < 29; i++) await attempt('::ffff:192.0.2.1');
  expect(await attempt('192.0.2.1')).toMatch(/连接过于频繁/);
});
test('account concurrent socket cap remains enforced', async () => {
  presence.onlineUsers.set('f01-user', new Set(['1', '2', '3', '4', '5']));
  try { expect(await connect(proxyUrl, '127.0.0.2')).toMatch(/连接数超限/); }
  finally { presence.onlineUsers.delete('f01-user'); }
  expect(await connect(proxyUrl, '127.0.0.2')).toBe('ok');
});
