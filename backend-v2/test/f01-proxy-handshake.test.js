'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const realtime = require('../src/realtime');
const presence = require('../src/realtime/presence');
const middleware = [];
realtime({ use: fn => middleware.push(fn), on() {} });
const token = jwt.sign({ id: 'f01-user' }, config.jwtSecret, { expiresIn: '1h' });
beforeAll(() => db.prepare('INSERT INTO users(id,username,phone,password) VALUES (?,?,?,?)').run('f01-user', 'f01-user', 'f01-phone', 'synthetic'));
beforeEach(() => realtime._resetIpHandshake());
afterEach(() => jest.restoreAllMocks());
afterAll(async () => { await require('../src/db/writer').shutdown(); });
async function connect(ip, { peer = '127.0.0.1', headers = {}, authenticated = true } = {}) {
  const socket = { handshake: { address: peer, headers: { 'x-real-ip': ip, ...headers }, auth: authenticated ? { token } : {} } };
  for (const fn of middleware) {
    const error = await new Promise(resolve => fn(socket, resolve));
    if (error) return error.message;
  }
  return 'ok';
}
test('31 concurrent proxy handshakes with distinct client IPs each get their own quota', async () => {
  const results = await Promise.all(Array.from({ length: 31 }, (_, i) => connect(`192.0.2.${i + 1}`)));
  expect(results.filter(result => result === 'ok')).toHaveLength(31);
});
test('same source reconnect: 30 succeed, 31st denied despite rotating XFF', async () => {
  for (let i = 0; i < 30; i++) expect(await connect('192.0.2.1', { headers: { 'x-forwarded-for': `198.51.100.${i}` } })).toBe('ok');
  expect(await connect('192.0.2.1')).toMatch(/连接过于频繁/);
});
test('direct untrusted peer cannot spoof forwarding headers', async () => {
  for (let i = 0; i < 30; i++) expect(await connect(`192.0.2.${i}`, { peer: '198.51.100.1' })).toBe('ok');
  expect(await connect('192.0.2.31', { peer: '198.51.100.1' })).toMatch(/连接过于频繁/);
});
test.each([['2001:db8::1', '2001:0db8:0:0:0:0:0:1'], ['192.0.2.1', '::ffff:192.0.2.1']])('equivalent addresses %s and %s share quota', async (a, b) => {
  for (let i = 0; i < 30; i++) expect(await connect(i % 2 ? a : b, { peer: '::ffff:127.0.0.1' })).toBe('ok');
  expect(await connect(a)).toMatch(/连接过于频繁/);
  expect(await connect('192.0.2.99')).toBe('ok');
});
test('invalid, multiple and missing X-Real-IP fall back to the TCP peer', async () => {
  for (let i = 0; i < 30; i++) expect(await connect(i % 2 ? 'garbage' : '192.0.2.1, 192.0.2.2')).toBe('ok');
  expect(await connect(undefined)).toMatch(/连接过于频繁/);
});
test('unauthenticated flood from one client does not consume a different client quota', async () => {
  for (let i = 0; i < 30; i++) expect(await connect('192.0.2.1', { authenticated: false })).toBe('未授权');
  for (let i = 0; i < realtime.GLOBAL_HANDSHAKE_MAX; i++) expect(await connect('192.0.2.1', { authenticated: false })).toMatch(/连接过于频繁/);
  expect(await connect('192.0.2.2')).toBe('ok');
});
test('window expiry permits reconnect and account socket cap remains enforced', async () => {
  let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now);
  for (let i = 0; i < 30; i++) await connect('192.0.2.1');
  expect(await connect('192.0.2.1')).toMatch(/连接过于频繁/);
  now += 60001;
  expect(await connect('192.0.2.1')).toBe('ok');
  presence.onlineUsers.set('f01-user', new Set(['1', '2', '3', '4', '5']));
  try { expect(await connect('192.0.2.2')).toMatch(/连接数超限/); }
  finally { presence.onlineUsers.delete('f01-user'); }
  expect(await connect('192.0.2.2')).toBe('ok');
});
test('independent global budget limits distributed unauthenticated handshakes and resets', async () => {
  let now = Date.now(); jest.spyOn(Date, 'now').mockImplementation(() => now);
  for (let i = 0; i < realtime.GLOBAL_HANDSHAKE_MAX; i++) {
    expect(await connect(`2001:db8::${(i + 1).toString(16)}`, { authenticated: false })).toBe('未授权');
  }
  expect(await connect('192.0.2.1')).toMatch(/服务繁忙/);
  now += 60001;
  expect(await connect('192.0.2.1')).toBe('ok');
});
test('documented residual: rotating 31 IPv6 addresses within one /64 has separate quotas', async () => {
  for (let i = 1; i <= 31; i++) expect(await connect(`2001:db8:1234:5678::${i.toString(16)}`)).toBe('ok');
  // The existing global-budget test uses this same /64 and proves the 6001st denial.
});
