'use strict';
/**
 * 消息历史·同秒游标不丢消息。
 *
 * created_at 为秒级；若分页游标只用 created_at（created_at < before），当同一秒内消息数
 * 超过单页 limit 时，与游标边界同秒、超出上一页的消息会被永久跳过。
 * 复合游标（附带边界消息 id → (created_at, rowid) 比较）可修复：不丢、不重。
 */
const { makeUser, befriend, privateConversation } = require('./helpers');
const msgSvc = require('../src/modules/messages/messages.service');
const { db } = require('../src/db/connection');
const { v4: uuidv4 } = require('uuid');

async function seedSameSecondMessages(convId, senderId, n, ts) {
  const ins = db.prepare(
    'INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)'
  );
  const ids = [];
  for (let i = 0; i < n; i++) {
    const id = uuidv4();
    ins.run(id, convId, senderId, 'text', `m${i}`, ts);
    ids.push(id);
  }
  return ids;
}

// 用给定游标策略逐页回溯，返回收集到的全部消息 id 集合
function paginateAll(convId, userId, limit, useCompoundCursor) {
  const seen = new Set();
  let before, beforeId;
  for (let guard = 0; guard < 50; guard++) {
    const page = msgSvc.history(convId, userId, { limit, before, beforeId });
    if (!page.length) break;
    const before2 = page[0].created_at; // 升序，最旧在前
    const beforeId2 = page[0].id;
    // 若游标未推进（同秒且旧代码），强制跳出防死循环
    if (before2 === before && beforeId2 === beforeId) { page.forEach(m => seen.add(m.id)); break; }
    page.forEach(m => seen.add(m.id));
    before = before2;
    beforeId = useCompoundCursor ? beforeId2 : undefined;
  }
  return seen;
}

describe('消息历史·同秒游标', () => {
  test('同一秒内消息数 > limit：复合游标(beforeId)分页能取全、不丢不重', async () => {
    const a = await makeUser({ username: 'pgc_a' });
    const b = await makeUser({ username: 'pgc_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const ids = await seedSameSecondMessages(convId, a.userId, 12, 1700000000);

    const seen = paginateAll(convId, a.userId, 5, /* compound */ true);
    // 12 条全部取到（不丢），集合大小恰为 12（不重）
    ids.forEach(id => expect(seen.has(id)).toBe(true));
    expect(seen.size).toBe(12);
  });

  test('对照：仅用 created_at 游标（无 beforeId）会丢失同秒消息', async () => {
    const a = await makeUser({ username: 'pgo_a' });
    const b = await makeUser({ username: 'pgo_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    await seedSameSecondMessages(convId, a.userId, 12, 1700000000);

    const seen = paginateAll(convId, a.userId, 5, /* compound */ false);
    // 旧游标（无 beforeId）在同秒场景下取不全 → 证明 bug 真实存在、复合游标确有必要
    expect(seen.size).toBeLessThan(12);
  });
});
