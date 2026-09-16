'use strict';
const { fork, spawn } = require('child_process');
const { randomUUID } = require('crypto');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
let redis, dir, redisPort;
const workers = [], ports = [];
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill('SIGTERM');
  });
}
async function startRedis() {
  redis = spawn('redis-server', ['--bind', '127.0.0.1', '--port', String(redisPort), '--save', '', '--appendonly', 'no', '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Temporary Redis startup timed out')), 5000);
    redis.once('error', error => { clearTimeout(timeout); reject(error); });
    redis.stdout.on('data', data => { if (/ready to accept connections/i.test(String(data))) { clearTimeout(timeout); resolve(); } });
  });
}
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touliao-rate-'));
  redisPort = await new Promise(resolve => { const socket = net.createServer(); socket.listen(0, '127.0.0.1', () => { const port = socket.address().port; socket.close(() => resolve(port)); }); });
  await startRedis();
  const prefix = `test:${randomUUID()}:`;
  for (let i = 0; i < 2; i++) {
    const child = fork(path.join(__dirname, 'fixtures/rate-limit-server.cjs'), [], { silent: true,
      env: { ...process.env, TEST_REDIS_URL: `redis://127.0.0.1:${redisPort}`, TEST_RATE_PREFIX: prefix } });
    workers.push(child);
    ports.push(await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Limiter worker startup timed out')), 5000);
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('message', message => { clearTimeout(timeout); resolve(message.port); });
    }));
  }
}, 20000);
afterAll(async () => {
  for (const child of workers) await stop(child);
  await stop(redis);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});
const hit = index => fetch(`http://127.0.0.1:${ports[index]}/limited`, { signal: AbortSignal.timeout(8000) });
test('two cold application processes share the same counter on their first requests', async () => {
  const first = await Promise.all([hit(0), hit(1)]);
  expect(first.map(response => response.status)).toEqual([200, 200]);
  expect((await hit(0)).status).toBe(429);
  expect((await hit(1)).status).toBe(429);
});
test('Redis outage fails closed and reconnection restores service', async () => {
  await stop(redis);
  const failed = await hit(0);
  expect(failed.status).toBe(503);
  expect((await failed.json()).error_code).toBe('RATE_LIMIT_UNAVAILABLE');
  await startRedis();
  expect((await hit(0)).status).toBe(200);
}, 20000);
