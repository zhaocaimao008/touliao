'use strict';
// 群通话历史接入回归测试（AUDIT.md「遗留待办」：group_call_logs 已落库但历史页只查
// call_logs，群通话记录永远不展示）。getCallLogs 现在 UNION 两张表，按时间倒序合并。

const { v4: uuid } = require('uuid');
const { db } = require('../src/db/connection');
const { getCallLogs } = require('../src/modules/users/users.service');

function seedUser(id, username) {
  // wechat_id 有唯一索引（idx_users_wechat_id_unique），空字符串也会被当成重复值，
  // 每个测试用户必须给一个各不相同的值（不能都留空字符串默认值）。
  db.prepare('INSERT INTO users (id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)')
    .run(id, username, `1${id.slice(0, 10)}`, 'x', id.slice(0, 8));
}

function seedGroupConversation(id, name, memberIds) {
  db.prepare("INSERT INTO conversations (id,type,name,avatar) VALUES (?,'group',?,?)").run(id, name, '');
  for (const uid of memberIds) {
    db.prepare('INSERT INTO conversation_members (conversation_id,user_id) VALUES (?,?)').run(id, uid);
  }
}

function seedCallLog({ id, callerId, calleeId, createdAt }) {
  db.prepare(
    "INSERT INTO call_logs (id,caller_id,callee_id,type,status,started_at,ended_at,duration,created_at) VALUES (?,?,?,?,'completed',?,?,?,?)"
  ).run(id, callerId, calleeId, 'audio', createdAt, createdAt + 30, 30, createdAt);
}

function seedGroupCallLog({ id, conversationId, startedBy, status = 'ended', startedAt, endedAt, peak = 2 }) {
  db.prepare(
    'INSERT INTO group_call_logs (id,conversation_id,started_by,type,status,participant_count,started_at,ended_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, conversationId, startedBy, 'video', status, peak, startedAt, endedAt);
}

describe('getCallLogs：私聊 + 群通话合并历史', () => {
  test('群通话记录出现在历史里，群名/群头像替代 peer，按时间倒序与私聊混排', () => {
    const alice = uuid(), bob = uuid(), carol = uuid();
    seedUser(alice, `alice-${alice.slice(0, 8)}`);
    seedUser(bob, `bob-${bob.slice(0, 8)}`);
    seedUser(carol, `carol-${carol.slice(0, 8)}`);
    const conv = uuid();
    seedGroupConversation(conv, '摸鱼群', [alice, bob, carol]);

    const privateCall = uuid();
    const groupCall = uuid();
    seedCallLog({ id: privateCall, callerId: alice, calleeId: bob, createdAt: 1000 });
    seedGroupCallLog({ id: groupCall, conversationId: conv, startedBy: bob, startedAt: 2000, endedAt: 2050, peak: 3 });

    const rows = getCallLogs(alice, 50);
    const group = rows.find(r => r.id === groupCall);
    const priv = rows.find(r => r.id === privateCall);

    expect(group).toBeDefined();
    expect(group).toMatchObject({
      kind: 'group', status: 'completed', direction: 'in', peer_id: null,
      peer_name: '摸鱼群', conversation_id: conv, participant_count: 3, duration: 50,
    });
    expect(priv).toMatchObject({ kind: 'private', direction: 'out', peer_id: bob });
    // 群通话(created_at=2000) 比私聊(created_at=1000)新 → 排在前面
    expect(rows.indexOf(group)).toBeLessThan(rows.indexOf(priv));
  });

  test('非该群成员看不到这条群通话记录', () => {
    const alice = uuid(), bob = uuid(), outsider = uuid();
    seedUser(alice, `alice-${alice.slice(0, 8)}`);
    seedUser(bob, `bob-${bob.slice(0, 8)}`);
    seedUser(outsider, `outsider-${outsider.slice(0, 8)}`);
    const conv = uuid();
    seedGroupConversation(conv, '仅两人群', [alice, bob]);
    const groupCall = uuid();
    seedGroupCallLog({ id: groupCall, conversationId: conv, startedBy: alice, startedAt: 3000, endedAt: 3010 });

    const rows = getCallLogs(outsider, 50);
    expect(rows.find(r => r.id === groupCall)).toBeUndefined();
  });

  test('仍在进行中的群通话状态映射为 ongoing', () => {
    const alice = uuid(), bob = uuid();
    seedUser(alice, `alice-${alice.slice(0, 8)}`);
    seedUser(bob, `bob-${bob.slice(0, 8)}`);
    const conv = uuid();
    seedGroupConversation(conv, '进行中的群', [alice, bob]);
    const groupCall = uuid();
    seedGroupCallLog({ id: groupCall, conversationId: conv, startedBy: alice, status: 'ongoing', startedAt: 4000, endedAt: null });

    const rows = getCallLogs(alice, 50);
    expect(rows.find(r => r.id === groupCall)).toMatchObject({ status: 'ongoing', duration: 0 });
  });
});
