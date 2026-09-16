'use strict';
/**
 * Q12 全修回归：会话数超过 500 后，列表无法续页 + 自动订阅房间跟列表展示的集合
 * 可能不一致（旧实现：列表按"置顶优先/最近活跃优先"排序取前 500，自动订阅按
 * conversation_members 插入顺序无 ORDER BY 取前 500 —— 两者不保证是同一批）。
 */
require('./testEnv');
const { db } = require('../src/db/connection');
const { makeUser } = require('./helpers');
const conversationsService = require('../src/modules/conversations/conversations.service');
const { autoJoinConversationIds } = require('../src/realtime/index');

function makeGroup(id, createdAt) {
  db.prepare('INSERT INTO conversations (id, type, name, created_at) VALUES (?, ?, ?, ?)')
    .run(id, 'group', id, createdAt);
}
function addMember(convId, userId, joinedAt) {
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)')
    .run(convId, userId, joinedAt);
}

describe('Q12 会话列表/自动订阅超量续页与排序一致性', () => {
  test('listConversations 用 offset/limit 稳定续页：501 个会话不丢不重，默认行为(前500)不变', async () => {
    const u = await makeUser({ username: 'q12_page_u' });
    const total = 501;
    const ids = [];
    // makeUser 首次列表会自动建"文件传输助手"会话，created_at 是真实当前时间戳；
    // 合成会话的 created_at 都设成远大于"现在"，保证不管真实时钟是多少，
    // 这 501 个合成会话恒排在文件传输助手前面，不干扰下面的边界断言。
    const base = Math.floor(Date.now() / 1000) + 10_000_000;
    db.transaction(() => {
      for (let i = 0; i < total; i++) {
        const id = `q12-page-${u.userId}-${i}`;
        // created_at 递增：i 越大越"新"（越靠前展示）
        makeGroup(id, base + i);
        addMember(id, u.userId, base + i);
        ids.push(id);
      }
    })();

    // 文件传输助手会话真实 created_at 远小于上面故意调大的合成时间戳，排在合成会话
    // 之后——只关心 501 个合成会话彼此的相对顺序/完整性，断言前把它过滤掉。
    const isSynthetic = c => c.id.startsWith(`q12-page-${u.userId}-`);

    const firstPage = (await conversationsService.listConversations(u.userId, {})).filter(isSynthetic);
    expect(firstPage).toHaveLength(500);
    // 默认（不传 offset/limit）必须还是旧行为：最新的 500 个，最新的排最前
    expect(firstPage[0].id).toBe(`q12-page-${u.userId}-${total - 1}`);

    const secondPage = (await conversationsService.listConversations(u.userId, { offset: 500, limit: 500 })).filter(isSynthetic);
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0].id).toBe(`q12-page-${u.userId}-0`); // 最旧的那个落在第二页

    // 两页拼起来覆盖全部 501 个、无重复
    const combined = new Set([...firstPage, ...secondPage].map(c => c.id));
    expect(combined.size).toBe(total);
    for (const id of ids) expect(combined.has(id)).toBe(true);
  });

  test('置顶会话即使不是最新，也排在续页更前面（跟旧行为一致，offset 不破坏置顶优先）', async () => {
    const u = await makeUser({ username: 'q12_pin_u' });
    const oldPinned = `q12-pin-old-${u.userId}`;
    const newer = `q12-pin-new-${u.userId}`;
    db.transaction(() => {
      makeGroup(oldPinned, 100);
      addMember(oldPinned, u.userId, 100);
      makeGroup(newer, 200);
      addMember(newer, u.userId, 200);
      db.prepare(`INSERT INTO conversation_settings (user_id, conversation_id, pinned) VALUES (?, ?, 1)`)
        .run(u.userId, oldPinned);
    })();

    const page = await conversationsService.listConversations(u.userId, {});
    const orderedIds = page.map(c => c.id);
    expect(orderedIds.indexOf(oldPinned)).toBeLessThan(orderedIds.indexOf(newer));
  });

  test('autoJoinConversationIds 排序跟 listConversations 一致：置顶优先、最近活跃优先，不是插入顺序', async () => {
    const user = await makeUser({ username: 'q12_auto_join_u' });
    const u = user.userId;
    // 故意按"从新到旧"的顺序插入(joined_at 递减)，制造"插入顺序"和"活跃顺序"相反的情形——
    // 旧实现(无 ORDER BY)在小 limit 下会截断掉最新的那个,新实现必须截断掉最旧的。
    const oldest = `q12-aj-oldest-${u}`;
    const middle = `q12-aj-middle-${u}`;
    const newest = `q12-aj-newest-${u}`;
    db.transaction(() => {
      makeGroup(newest, 300); addMember(newest, u, 10); // 最先插入 conversation_members(joined_at 最小)，但最新
      makeGroup(middle, 200); addMember(middle, u, 20);
      makeGroup(oldest, 100); addMember(oldest, u, 30); // 最后插入，但最旧
    })();

    const top2 = autoJoinConversationIds(db, u, 2);
    expect(top2).toEqual([newest, middle]); // 按活跃度取前2，不是按插入顺序取前2
    expect(top2).not.toContain(oldest);

    const all = autoJoinConversationIds(db, u, 500);
    expect(all).toEqual([newest, middle, oldest]);
  });

  test('autoJoinConversationIds 置顶优先于活跃度，口径跟 listConversations 完全一致', async () => {
    const u = await makeUser({ username: 'q12_aj_pin_u' });
    const oldPinned = `q12-aj-pin-old-${u.userId}`;
    const newer = `q12-aj-pin-new-${u.userId}`;
    db.transaction(() => {
      makeGroup(oldPinned, 100); addMember(oldPinned, u.userId, 100);
      makeGroup(newer, 200); addMember(newer, u.userId, 200);
      db.prepare(`INSERT INTO conversation_settings (user_id, conversation_id, pinned) VALUES (?, ?, 1)`)
        .run(u.userId, oldPinned);
    })();

    const listOrder = (await conversationsService.listConversations(u.userId, {})).map(c => c.id);
    const joinOrder = autoJoinConversationIds(db, u.userId, 500);
    // 两者对这两个会话的相对顺序必须一致
    const relOrder = arr => arr.filter(id => id === oldPinned || id === newer);
    expect(relOrder(joinOrder)).toEqual(relOrder(listOrder));
    expect(relOrder(joinOrder)).toEqual([oldPinned, newer]);
  });
});
