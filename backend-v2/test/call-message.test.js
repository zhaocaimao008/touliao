'use strict';
/**
 * 回归:通话结束写聊天窗口系统消息(type='call',微信行为对齐)。
 *
 * 契约:
 *  1. 四终态(completed/canceled/rejected/missed)都落库一条 type='call' 消息,
 *     content 为 JSON,含 callId/status/duration/callType/callerId/text。
 *  2. 幂等:同一 callId 只写一条(查重 content LIKE %callId%)。
 *  3. 1 对 1 自动找双方私聊会话;无会话(非好友)不落库、不报错。
 *  4. 群通话传 conversationId 直写。
 *  5. 历史不补:只对新通话写,不回溯 call_logs(本测试只验证 writeCallMessage 行为)。
 */
const { makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { writeCallMessage } = require('../src/realtime/callMessage');

// 测试环境 app 已 setIo(broadcaster),直接调用即可;io 只用于 emitSyncAvailable
const mockIo = { to: () => ({ emit: () => {} }) };

function lastCallMessages() {
  return db.prepare(
    "SELECT * FROM messages WHERE type='call' ORDER BY created_at DESC, rowid DESC"
  ).all();
}

function parseContent(row) {
  try { return JSON.parse(row.file_url); } catch { return null; }
}

describe('通话系统消息(type=call)', () => {
  let a, b;
  let convId;

  beforeAll(async () => {
    a = await makeUser({ username: 'call_msg_a' });
    b = await makeUser({ username: 'call_msg_b' });
    await befriend(a, b);                       // 好友关系是建私聊前置
    convId = await privateConversation(a, b);
  });

  beforeEach(() => {
    db.prepare("DELETE FROM messages WHERE type='call'").run();
  });

  test('completed 落库:字段齐全、广播到私聊会话、双方可见(sender=caller)', async () => {
    await writeCallMessage({
      callId: 'call-completed-1', status: 'completed', duration: 30, callType: 'audio',
      callerId: a.userId, calleeId: b.userId,
    }, mockIo);

    const rows = lastCallMessages();
    expect(rows.length).toBe(1);
    expect(rows[0].conversation_id).toBe(convId);
    expect(rows[0].sender_id).toBe(a.userId);       // 主叫发出 → 双方都看到
    expect(rows[0].content).toBe('语音通话 30 秒'); // content = 人话(老客户端兜底直接显示)
    const c = parseContent(rows[0]);                // 结构化 JSON 在 file_url
    expect(c.callId).toBe('call-completed-1');
    expect(c.status).toBe('completed');
    expect(c.duration).toBe(30);
    expect(c.callType).toBe('audio');
    expect(c.callerId).toBe(a.userId);
  });

  test('四种 status 的 content 文案正确(file_url 结构化)', async () => {
    const cases = [
      ['completed', 90, '语音通话 1 分 30 秒'],
      ['canceled', 0, '已取消'],
      ['rejected', 0, '对方已拒绝'],
      ['missed', 0, '对方无应答'],
    ];
    for (const [status, duration, expectText] of cases) {
      await writeCallMessage({
        callId: `call-${status}-1`, status, duration, callType: 'audio',
        callerId: a.userId, calleeId: b.userId,
      }, mockIo);
    }
    const rows = lastCallMessages();
    expect(rows.length).toBe(4);
    // content 是人话
    const texts = rows.map(r => r.content);
    for (const t of cases) expect(texts).toContain(t[2]);
    // file_url 是结构化 JSON(含 callId/status/callerId)
    const metas = rows.map(r => parseContent(r));
    expect(metas.every(m => m && m.callId && m.status && m.callerId)).toBe(true);
  });

  test('幂等:同一 callId 重复写只落一条', async () => {
    const opts = {
      callId: 'call-dupe-1', status: 'completed', duration: 10, callType: 'audio',
      callerId: a.userId, calleeId: b.userId,
    };
    await writeCallMessage(opts, mockIo);
    await writeCallMessage(opts, mockIo);
    await writeCallMessage(opts, mockIo);
    expect(lastCallMessages().length).toBe(1);
  });

  test('无私聊会话(非好友)→ 不落库不报错', async () => {
    const stranger = await makeUser({ username: 'call_msg_x' });
    await writeCallMessage({
      callId: 'call-noconv-1', status: 'missed', duration: 0, callType: 'audio',
      callerId: a.userId, calleeId: stranger.userId,
    }, mockIo);
    expect(lastCallMessages().length).toBe(0);
  });

  test('群通话:传 conversationId 直写,带 participants', async () => {
    await writeCallMessage({
      callId: 'call-group-1', status: 'completed', duration: 120, callType: 'video',
      callerId: a.userId, conversationId: convId, participants: 5,
    }, mockIo);
    const rows = lastCallMessages();
    expect(rows.length).toBe(1);
    expect(rows[0].conversation_id).toBe(convId);
    const c = parseContent(rows[0]);
    expect(c.participants).toBe(5);
    expect(rows[0].content).toBe('视频通话 2 分钟');
  });
});
