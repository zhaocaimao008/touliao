'use strict';
/**
 * P1-06 清空聊天记录后消息复活 回归测试
 *
 * 产品语义（2026-09-08 修订，Q04）：clearConversation 是双向/全员的——UI 文案
 * （privateChat.confirmClearTemplate / groupInfo.confirmClearMessagesTemplate，
 * I18nContext.jsx）历来就写"双向删除/所有成员都将看不到"；此前实现只写了
 * per-user watermark（conversation_clears.cleared_at），对方仍能看到原文，文实不符。
 * 现在 clearConversation 物理清空消息内容（deleted=2/content=''，对全体成员生效），
 * conversation_clears watermark 仍写入，但只是既有读路径的双重保险，不再是唯一机制。
 * 所有读取路径必须统一尊重"内容已清空"：
 *   消息分页 listMessages / 会话内搜索 / missed 断线补拉 / 全局搜索（LIKE+FTS5）/
 *   会话列表 lastMessage+unread / 导出 exportConversation / 对方（未发起清空的一方）的同一批路径
 *
 * 修复前（P1-06 首版）：missed / searchGlobal / listConversations / exportConversation
 * 未过滤 cleared_at → 清空后重连/搜索/列表/导出会把历史消息重新拉回（复活）。
 * 本次（Q04）：这些路径对发起清空者已经正确；缺口是对方——旧实现里对方完全不受影响，
 * 与 UI 承诺的"双向"矛盾，现改为对方也真的看不到。
 */
require('./testEnv');
const request = require('supertest');
const { app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');

describe('P1-06 清空聊天记录消息复活', () => {
  let a, b, convId, oldMsgId, newMsgId;

  beforeAll(async () => {
    a = await makeUser({ username: 'p106_a' });
    b = await makeUser({ username: 'p106_b' });
    await befriend(a, b);
    convId = await privateConversation(a, b);
  });

  async function sendMsg(token, content) {
    const res = await request(app)
      .post(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'text', content });
    expect(res.status).toBe(200);
    return res.body;
  }

  test('清空前消息存在；清空后分页/missed/搜索/导出/会话列表均不再返回', async () => {
    // 发一条旧消息（清空前的历史）
    const old = await sendMsg(a.token, '清空前的机密历史消息 p106-secret');
    oldMsgId = old.id;

    // 清空会话（双向，对 a/b 均生效）——实际路由：DELETE /api/messages/conversation/:convId/messages
    const clearRes = await request(app)
      .delete(`/api/messages/conversation/${convId}/messages`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(clearRes.status).toBe(200);

    // ① 消息分页：不再返回旧消息
    const history = await request(app)
      .get(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(history.status).toBe(200);
    expect(history.body.items || history.body.messages || history.body).not.toContain(history.body.items ? oldMsgId : undefined);
    const histItems = history.body.items || history.body.messages || [];
    expect(histItems.map(m => m.id)).not.toContain(oldMsgId);

    // ② 断线补拉 missed（after=0 之前）：不返回旧消息
    const missed = await request(app)
      .get('/api/messages/missed?after=1')
      .set('Authorization', `Bearer ${a.token}`);
    expect(missed.status).toBe(200);
    const missedArr = Array.isArray(missed.body) ? missed.body : (missed.body.messages || []);
    expect(missedArr.map(m => m.id)).not.toContain(oldMsgId);

    // ③ 全局搜索：搜不到已清空消息
    const search = await request(app)
      .get('/api/messages/search?q=p106-secret')
      .set('Authorization', `Bearer ${a.token}`);
    expect(search.status).toBe(200);
    const searchArr = search.body.results || search.body.messages || [];
    expect(searchArr.map(m => m.id)).not.toContain(oldMsgId);

    // ③b 会话内搜索（GET /api/search/messages）：同样不返回已清空消息
    const inConv = await request(app)
      .get(`/api/search/messages?conversationId=${convId}&q=p106-secret`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(inConv.status).toBe(200);
    const inConvArr = inConv.body.results || inConv.body.messages || [];
    expect(inConvArr.map(m => m.id)).not.toContain(oldMsgId);

    // ③c 双向：b 没有主动清空，但 a 清空是双向生效的——b 的会话内搜索同样搜不到
    const bInConv = await request(app)
      .get(`/api/search/messages?conversationId=${convId}&q=p106-secret`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(bInConv.status).toBe(200);
    const bInConvArr = bInConv.body.results || bInConv.body.messages || [];
    expect(bInConvArr.map(m => m.id)).not.toContain(oldMsgId);

    // ③d 全局搜索（/api/search/global，走 searchMessagesInConversations 跨会话 FTS）：
    // P0 参数绑定回归——修复前参数数组顺序错位（[ftsPhrase, userId, ...convIds]）导致
    // 单会话用户恒空 / 双会话水位线失效（已清空消息复活）。
    const gSearch = await request(app)
      .get(`/api/search/global?q=p106-secret`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(gSearch.status).toBe(200);
    const gArr = gSearch.body.results || [];
    expect(gArr.map(m => m.id)).not.toContain(oldMsgId);
    // total 与 results 一致（P1 修复：total COUNT 同样过滤水位线，不再虚高）
    expect(gSearch.body.total).toBe(0);

    // ③e 双向：b 的全局搜索同样搜不到（a 的清空对 b 也生效）
    const bGSearch = await request(app)
      .get(`/api/search/global?q=p106-secret`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(bGSearch.status).toBe(200);
    const bGArr = bGSearch.body.results || [];
    expect(bGArr.map(m => m.id)).not.toContain(oldMsgId);
    expect(bGSearch.body.total).toBe(0);

    // ③f 全局搜索（LIKE 分支，2 字短词）：同样不返回已清空消息
    const shortRes = await request(app)
      .get(`/api/search/global?q=p1`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(shortRes.status).toBe(200);
    const shortArr = shortRes.body.results || [];
    expect(shortArr.map(m => m.id)).not.toContain(oldMsgId);

    // ④ 会话列表 lastMessage：不再是旧消息
    const convs = await request(app)
      .get('/api/messages/conversations')
      .set('Authorization', `Bearer ${a.token}`);
    expect(convs.status).toBe(200);
    const list = convs.body.conversations || convs.body || [];
    const mine = list.find(c => c.id === convId);
    if (mine) {
      expect(mine.lastMessage).not.toBe('清空前的机密历史消息 p106-secret');
    }

    // ⑤ 导出：不包含已清空消息
    const exportRes = await request(app)
      .get(`/api/messages/conversation/${convId}/export`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.text).not.toContain('清空前的机密历史消息 p106-secret');

    // ⑥ 双向：对方 b 没有主动清空，但同样看不到旧消息（UI 承诺"对方也将看不到"）
    const bHistory = await request(app)
      .get(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${b.token}`);
    const bItems = Array.isArray(bHistory.body) ? bHistory.body : (bHistory.body.items || bHistory.body.messages || []);
    expect(bItems.map(m => m.id)).not.toContain(oldMsgId);
  });

  test('清空后新消息正常可见（watermark 之后的消息不隐藏）', async () => {
    const fresh = await sendMsg(b.token, '清空后的新消息 p106-fresh');
    const history = await request(app)
      .get(`/api/messages/${convId}`)
      .set('Authorization', `Bearer ${a.token}`);
    const items = Array.isArray(history.body) ? history.body : (history.body.items || history.body.messages || []);
    expect(items.map(m => m.id)).toContain(fresh.id);
  });
});
