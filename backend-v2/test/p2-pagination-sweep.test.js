'use strict';
// 2026-09-24 分页边界全量收口：后台列表、会话文件、@提及、收藏、举报、搜索建议全部走 utils/pagination，
// 负数 / 小数 / 非数字 / 重复参数一律 400；搜索建议与排序不再暴露其他用户的搜索词。
const jwt = require('jsonwebtoken');
const { app, request, makeUser, befriend, privateConversation } = require('./helpers');
const config = require('../src/config');
const SearchRanking = require('../src/utils/searchRanking');

const BAD_LIMITS = ['-1', '0', '1.5', 'abc', '1e2', ''];
let user, peer, conv, adminCookie;

beforeAll(async () => {
  user = await makeUser(); peer = await makeUser();
  await befriend(user, peer);
  conv = await privateConversation(user, peer);
  const token = jwt.sign({ admin: true, username: config.admin.username, csrf: 'sweep-csrf' },
    config.adminJwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
  adminCookie = `touliao_admin_token=${token}`;
});

const asUser = (path, who = user) => request(app).get(path).set('Authorization', `Bearer ${who.token}`);
const asAdmin = path => request(app).get(path).set('Cookie', adminCookie);
const withQuery = (path, query) => path + (path.includes('?') ? '&' : '?') + query;

const userEndpoints = [
  ['conversation files', () => `/api/messages/conversation/${conv}/files`],
  ['mentions', () => '/api/messages/mentions/me'],
  ['collections', () => '/api/users/me/collections'],
  ['collection search', () => '/api/users/me/collections/search?q=x'],
];
const adminEndpoints = [
  // name, path, default page size
  ['admin users', '/api/admin/users', 30],
  ['admin messages', '/api/admin/messages', 30],
  ['admin groups', '/api/admin/groups', 30],
  ['admin top inviters', '/api/admin/top-inviters', 20],
];

describe.each(userEndpoints)('%s', (name, path) => {
  test.each(BAD_LIMITS)('rejects limit=%s with 400', async value => {
    expect((await asUser(withQuery(path(), `limit=${value}`))).status).toBe(400);
  });
  test('rejects negative and fractional offset with 400', async () => {
    expect((await asUser(withQuery(path(), 'offset=-1'))).status).toBe(400);
    expect((await asUser(withQuery(path(), 'offset=1.5'))).status).toBe(400);
  });
  test('keeps defaults and accepts valid and oversized limits', async () => {
    expect((await asUser(path())).status).toBe(200);
    expect((await asUser(withQuery(path(), 'limit=30&offset=0'))).status).toBe(200);
    expect((await asUser(withQuery(path(), 'limit=100000'))).status).toBe(200);
  });
});

describe.each(adminEndpoints)('%s', (name, path, defaultSize) => {
  test.each(BAD_LIMITS)('rejects limit=%s with 400', async value => {
    expect((await asAdmin(withQuery(path, `limit=${value}`))).status).toBe(400);
  });
  test('keeps the default, accepts the admin panel page size and caps oversized limits at 100', async () => {
    const byDefault = await asAdmin(path);
    expect(byDefault.status).toBe(200); expect(byDefault.body.limit).toBe(defaultSize);
    const panel = await asAdmin(withQuery(path, 'limit=30&offset=0'));
    expect(panel.status).toBe(200); expect(panel.body.limit).toBe(30);
    const huge = await asAdmin(withQuery(path, 'limit=100000'));
    expect(huge.status).toBe(200); expect(huge.body.limit).toBe(100);
  });
  if (name !== 'admin top inviters') {
    test('rejects negative and fractional offset with 400', async () => {
      expect((await asAdmin(withQuery(path, 'offset=-1'))).status).toBe(400);
      expect((await asAdmin(withQuery(path, 'offset=1.5'))).status).toBe(400);
    });
  }
});

test('admin user list returns at most 100 rows even when more exist', async () => {
  const { db } = require('../src/db/connection');
  const insert = db.prepare('INSERT INTO users(id,username,phone,password,wechat_id) VALUES(?,?,?,?,?)');
  db.transaction(() => { for (let i = 0; i < 105; i++) { const id = `sweep-user-${i}`; insert.run(id, id, `sweep-${i}`, 'synthetic', id); } })();
  const res = await asAdmin('/api/admin/users?limit=100000');
  expect(res.status).toBe(200);
  expect(res.body.total).toBeGreaterThan(100);
  expect(res.body.users).toHaveLength(100);
  expect((await asAdmin('/api/admin/users?limit=-1')).status).toBe(400);
});

describe('search suggestions and ranking', () => {
  let previous;
  beforeAll(() => { previous = app.get('searchRanking'); app.set('searchRanking', new SearchRanking()); });
  afterAll(() => app.set('searchRanking', previous));
  const rank = (who, body) => request(app).post('/api/optimization/search/rank')
    .set('Authorization', `Bearer ${who.token}`).send(body);

  test("never exposes another user's search terms", async () => {
    expect((await rank(peer, { query: 'secretpeerterm', messages: [] })).status).toBe(200);
    expect((await rank(user, { query: 'secretmine', messages: [] })).status).toBe(200);
    for (const limit of ['5', '20', '100000']) {
      const res = await asUser(`/api/optimization/search/suggestions?prefix=secret&limit=${limit}`);
      expect(res.status).toBe(200);
      const queries = res.body.suggestions.map(s => s.query);
      expect(queries).toContain('secretmine');
      expect(queries).not.toContain('secretpeerterm');
    }
    const ranked = await rank(user, { query: 'anything', messages: [{ id: 'm1', content: 'anything here' }] });
    expect(ranked.status).toBe(200);
    expect(ranked.body).not.toHaveProperty('trending');
    expect(JSON.stringify(ranked.body)).not.toContain('secretpeerterm');
  });

  test.each(BAD_LIMITS)('suggestions reject limit=%s with 400', async value => {
    expect((await asUser(`/api/optimization/search/suggestions?limit=${value}`)).status).toBe(400);
  });

  test('suggestions reject non-string or overlong prefix', async () => {
    expect((await asUser('/api/optimization/search/suggestions?prefix[]=a')).status).toBe(400);
    expect((await asUser(`/api/optimization/search/suggestions?prefix=${'a'.repeat(101)}`)).status).toBe(400);
  });

  test('ranking validates query and message batch size', async () => {
    expect((await rank(user, { query: '', messages: [] })).status).toBe(400);
    expect((await rank(user, { query: ['x'], messages: [] })).status).toBe(400);
    expect((await rank(user, { query: 'a'.repeat(101), messages: [] })).status).toBe(400);
    expect((await rank(user, { query: 'x', messages: 'nope' })).status).toBe(400);
    expect((await rank(user, { query: 'x', messages: Array.from({ length: 501 }, (_, i) => ({ id: String(i) })) })).status).toBe(400);
  });

  test('trending helper never returns more than 50 entries for invalid limits', async () => {
    const ranking = new SearchRanking();
    for (const limit of [-1, 0, 1.5, NaN, 1e9]) {
      const rows = await ranking.getSearchTrending(limit);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeLessThanOrEqual(50);
    }
  });
});
