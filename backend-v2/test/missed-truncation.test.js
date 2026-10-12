'use strict';
/**
 * GET /messages/missed 命中上限时的截断标记（性能审计第 4 项收尾）
 *
 * 响应体仍是数组（兼容旧调用方）；超出 MISSED_LIMIT 时返回
 * X-Missed-Truncated: 1 与 X-Missed-Next-After，用后者作 after 续拉不丢消息。
 * created_at 只到秒：截断点所在那一秒的消息必须整体留到下一页。
 */
require('./testEnv');
const request = require('supertest');
const { randomUUID } = require('crypto');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { MISSED_LIMIT } = require('../src/modules/messages/messages.service');

describe('GET /messages/missed 截断标记', () => {
  let a, b, convId;
  const BASE = 1000;
  const DISTINCT = MISSED_LIMIT - 2;  // 前 998 条各占一秒
  const SAME_SECOND = 7;              // 之后 7 条挤在同一秒，跨过上限
  const TIE_TS = 5000;

  beforeAll(async () => {
    a = await makeUser({ username: 'missed_trunc_a' });
    b = await makeUser({ username: 'missed_trunc_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
    const ins = db.prepare(
      "INSERT INTO messages (id, conversation_id, sender_id, type, content, created_at) VALUES (?,?,?,'text',?,?)"
    );
    db.transaction(() => {
      for (let i = 0; i < DISTINCT; i++) ins.run(randomUUID(), convId, b.userId, `m${i}`, BASE + i);
      for (let i = 0; i < SAME_SECOND; i++) ins.run(randomUUID(), convId, b.userId, `tie${i}`, TIE_TS);
    })();
  });

  const get = after => request(app)
    .get(`/api/messages/missed?after=${after}`)
    .set('Authorization', `Bearer ${a.token}`);

  test('超出上限：标记截断，同秒消息整体留到下一页，续拉后不丢不重', async () => {
    const first = await get(BASE - 1);
    expect(first.status).toBe(200);
    expect(Array.isArray(first.body)).toBe(true);
    expect(first.headers['x-missed-truncated']).toBe('1');
    expect(first.body).toHaveLength(DISTINCT);
    expect(first.body.some(m => m.created_at === TIE_TS)).toBe(false);
    expect(first.headers['x-missed-next-after']).toBe(String(BASE + DISTINCT - 1));

    const second = await get(first.headers['x-missed-next-after']);
    expect(second.status).toBe(200);
    expect(second.headers['x-missed-truncated']).toBeUndefined();
    expect(second.body).toHaveLength(SAME_SECOND);

    const ids = [...first.body, ...second.body].map(m => m.id);
    expect(new Set(ids).size).toBe(DISTINCT + SAME_SECOND);
  });

  test('未超出上限：不带截断头', async () => {
    const res = await get(TIE_TS - 1);
    expect(res.status).toBe(200);
    expect(res.headers['x-missed-truncated']).toBeUndefined();
    expect(res.headers['x-missed-next-after']).toBeUndefined();
    expect(res.body).toHaveLength(SAME_SECOND);
  });
});
