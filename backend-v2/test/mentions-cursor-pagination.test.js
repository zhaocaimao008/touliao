'use strict';
/**
 * @我消息聚合分页：offset → (created_at, msgId) 复合游标（见 AUDIT.md 第九节"分页方式"🟡）。
 *
 * 核心场景：翻页过程中有新消息插入、或旧消息被撤回删除，不应出现重复或漏读。
 * 用 offset 分页会在这两种情况下都出错——新消息插入会把 offset 语义下的"第N条"往后
 * 推移，导致下一页重复看到上一页最后几条；游标分页天然不受影响，因为游标锚定在
 * 具体某条消息，不是"第几条"这个相对位置。
 *
 * 同时验证旧客户端兼容分支：不传 before/beforeId、只传 offset 时的行为完全不受影响
 * （见 messages.service.js getMentions 的兼容说明）。
 */
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');

async function sendMention(token, convId, text) {
  const res = await request(app)
    .post(`/api/messages/${convId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ content: text, type: 'text' });
  if (res.status >= 400) throw new Error(`发消息失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body; // { id, created_at, ... }
}

async function getMentions(token, params) {
  const res = await request(app)
    .get('/api/messages/mentions/me')
    .set('Authorization', `Bearer ${token}`)
    .query(params);
  if (res.status >= 400) throw new Error(`拉取@我消息失败 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

describe('@我消息聚合：游标分页', () => {
  test('翻页过程中插入新消息 + 删除旧消息，最终不重复、不漏读', async () => {
    const a = await makeUser({ username: 'mention_a' }); // 被@的人
    const b = await makeUser({ username: 'mention_b' }); // 发消息的人
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    // 先发 12 条 @a 的消息（B 发送，故意穿插几条不带 @ 的噪音消息，确认不会被误算进来）
    const seeded = [];
    for (let i = 1; i <= 12; i++) {
      const m = await sendMention(b.token, convId, `第${i}条 @${a.username} 你好`);
      seeded.push(m);
      await sendMention(b.token, convId, `噪音消息${i}，不带@`); // 不应该出现在结果里
    }
    // seeded 是插入顺序（旧→新），最新的在末尾：seeded[11] 是最新一条

    // ── 第1页：limit=5，不带 before，应该拿到最新的5条：seeded[11..7] ──
    const page1 = await getMentions(a.token, { limit: 5 });
    expect(page1.items).toHaveLength(5);
    expect(page1.hasMore).toBe(true);
    const page1Ids = page1.items.map(x => x.msgId);
    expect(page1Ids).toEqual([seeded[11].id, seeded[10].id, seeded[9].id, seeded[8].id, seeded[7].id]);

    // ── 翻页中途事件A：插入3条新的@a消息（模拟"用户正在翻页时，别人又发来新消息"）──
    const inserted = [];
    for (let i = 0; i < 3; i++) {
      inserted.push(await sendMention(b.token, convId, `翻页中插入的新消息${i} @${a.username}`));
    }

    // ── 翻页中途事件B：撤回一条"接下来该翻到"的旧消息（seeded[6]，彻底删除）──
    const recallRes = await request(app)
      .delete(`/api/messages/${seeded[6].id}`)
      .set('Authorization', `Bearer ${b.token}`)
      .send({ vanish: true });
    expect(recallRes.status).toBe(200);

    // ── 第2页：用第1页最后一条(seeded[7])的游标继续翻，不应该看到 inserted 的3条新消息
    //     （它们比游标新，游标是往"更旧"方向翻），也不应该重复看到第1页已经出现过的任何一条 ──
    const last1 = page1.items[page1.items.length - 1];
    const page2 = await getMentions(a.token, { limit: 5, before: last1.createdAt, beforeId: last1.msgId });
    const page2Ids = page2.items.map(x => x.msgId);

    // 期望：seeded[5..1]（seeded[6]被撤回，应该被跳过，不是漏读，是它真的被删了不该出现）
    expect(page2Ids).toEqual([seeded[5].id, seeded[4].id, seeded[3].id, seeded[2].id, seeded[1].id]);
    expect(page2.hasMore).toBe(true);

    // 关键断言：inserted 的3条一个都不该出现在第2页（游标翻页往旧方向走，不该看到更新的消息）
    for (const ins of inserted) expect(page2Ids).not.toContain(ins.id);
    // 关键断言：第2页和第1页没有任何重复
    expect(page2Ids.some(id => page1Ids.includes(id))).toBe(false);
    // 关键断言：被撤回的 seeded[6] 不出现在任何一页
    expect(page1Ids).not.toContain(seeded[6].id);
    expect(page2Ids).not.toContain(seeded[6].id);

    // ── 第3页：剩最后1条 seeded[0]，hasMore应该是false ──
    const last2 = page2.items[page2.items.length - 1];
    const page3 = await getMentions(a.token, { limit: 5, before: last2.createdAt, beforeId: last2.msgId });
    expect(page3.items.map(x => x.msgId)).toEqual([seeded[0].id]);
    expect(page3.hasMore).toBe(false);

    // ── 汇总断言：翻完全部3页，加起来正好是 seeded 里除了被撤回那条的11条，一条不多一条不少 ──
    const allPagedIds = [...page1Ids, ...page2Ids, ...page3.items.map(x => x.msgId)];
    const expectedIds = seeded.filter(m => m.id !== seeded[6].id).map(m => m.id);
    expect(allPagedIds.sort()).toEqual(expectedIds.sort());
    expect(new Set(allPagedIds).size).toBe(allPagedIds.length); // 无重复
  });

  test('旧客户端兼容分支：只传 offset（不传 before/beforeId）行为不受影响', async () => {
    const a = await makeUser({ username: 'mention_legacy_a' });
    const b = await makeUser({ username: 'mention_legacy_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);

    const seeded = [];
    for (let i = 1; i <= 6; i++) {
      seeded.push(await sendMention(b.token, convId, `旧客户端消息${i} @${a.username}`));
    }

    // 老式 offset 分页：第1页 offset=0，第2页 offset=3
    const page1 = await getMentions(a.token, { limit: 3, offset: 0 });
    const page2 = await getMentions(a.token, { limit: 3, offset: 3 });

    expect(page1.items.map(x => x.msgId)).toEqual([seeded[5].id, seeded[4].id, seeded[3].id]);
    expect(page2.items.map(x => x.msgId)).toEqual([seeded[2].id, seeded[1].id, seeded[0].id]);
    // total 字段仍然存在，没有被这次改动删掉（旧客户端还依赖它显示"共 X 条"）
    expect(page1.total).toBe(6);
    expect(page2.total).toBe(6);
  });

  test('不带任何分页参数时（真实首屏加载场景）返回最新一页 + hasMore/total 字段齐全', async () => {
    const a = await makeUser({ username: 'mention_first_a' });
    const b = await makeUser({ username: 'mention_first_b' });
    await befriend(a, b);
    const convId = await privateConversation(a, b);
    await sendMention(b.token, convId, `你好 @${a.username}`);

    const page1 = await getMentions(a.token, {});
    expect(page1.items.length).toBeGreaterThanOrEqual(1);
    expect(typeof page1.total).toBe('number');
    expect(typeof page1.hasMore).toBe('boolean');
  });
});
