'use strict';
// 2026-09-24 复查：F04 同类问题——搜索与媒体列表的 limit 没有下限（SQLite LIMIT -1 = 不限条数），
// /api/search/* 甚至没有上限，limit=-1 / 100000 会把用户可见的全部消息一次返回。
const { randomUUID } = require('crypto');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');

const TOTAL = 260;
let owner, conv;
const endpoints = [
  // name, path, default size, cap, supports offset
  ['messages search', () => '/api/messages/search?q=boundword', 20, 50, true],
  ['media list', () => '/api/messages/media?type=image', 60, 200, false],
  ['global search', () => '/api/search/global?q=boundword', 100, 100, true],
  ['conversation search', () => `/api/search/messages?conversationId=${conv}&q=boundword`, 50, 100, true],
];
const get = (path, query = '') => request(app).get(path + (query ? '&' + query : ''))
  .set('Authorization', `Bearer ${owner.token}`);
const items = res => Array.isArray(res.body) ? res.body : res.body.results;

beforeAll(async () => {
  owner = await makeUser();
  const peer = await makeUser();
  await befriend(owner, peer);
  conv = await privateConversation(owner, peer);
  const prefix = randomUUID(), now = Date.now();
  const insert = db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,created_at) VALUES (?,?,?,?,?,?,?)');
  db.transaction(() => {
    for (let i = 0; i < TOTAL; i++) {
      insert.run(`${prefix}-t-${i}`, conv, owner.userId, 'text', `boundword ${i}`, null, now - i * 1000);
      insert.run(`${prefix}-i-${i}`, conv, owner.userId, 'image', '', `/uploads/${prefix}-${i}.png`, now - i * 1000);
    }
  })();
});

describe.each(endpoints)('%s', (name, path, defaultSize, cap, supportsOffset) => {
  test.each(['-1', '0', '1.5', '', 'abc', '1abc', '1e2', '0x10', 'Infinity', 'NaN', '9007199254740992', '%20'])('rejects limit=%s with 400', async value => {
    const res = await get(path(), `limit=${value}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit/);
  });

  test.each(['limit=1&limit=2', 'limit[]=1'])('rejects non-scalar query %s', async query => {
    expect((await get(path(), query)).status).toBe(400);
  });

  test('keeps the default page size and caps valid large limits', async () => {
    const normal = await get(path());
    expect(normal.status).toBe(200); expect(items(normal)).toHaveLength(defaultSize);
    const large = await get(path(), 'limit=100000');
    expect(large.status).toBe(200); expect(items(large)).toHaveLength(cap);
    const one = await get(path(), 'limit=1');
    expect(one.status).toBe(200); expect(items(one)).toHaveLength(1);
  });

  if (supportsOffset) {
    test.each(['-1', '1.5', 'abc'])('rejects offset=%s with 400', async value => {
      expect((await get(path(), `offset=${value}`)).status).toBe(400);
    });
    test('advances offset without duplicates', async () => {
      const a = await get(path(), 'limit=1&offset=0');
      const b = await get(path(), 'limit=1&offset=1');
      expect(a.status).toBe(200); expect(b.status).toBe(200);
      expect(items(a)).toHaveLength(1); expect(items(b)).toHaveLength(1);
      expect(items(a)[0].id).not.toBe(items(b)[0].id);
    });
  }
});

test('clients that send limit=30 to /api/messages/search keep working', async () => {
  const res = await get('/api/messages/search?q=boundword', 'limit=30');
  expect(res.status).toBe(200); expect(items(res)).toHaveLength(30);
});
