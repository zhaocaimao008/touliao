'use strict';
/**
 * presence 资料缓存懒回填（2026-10-11 审计 presence 组）。
 *
 * 背景：资料缓存只在 socket connection 时 cacheProfile 一次；改名/换头像后
 * users.service 调 dropProfile 只删不填，之后该用户 socket 发出的每条消息
 * senderName/senderAvatar 都是空串（推送标题也跟着空），直到重新建连。
 * 修复：getProfile 未命中时对在线用户懒回填；离线用户不缓存，Map 仍只含在线用户，
 * 由 cleanupUser 收敛。
 */
require('./testEnv');
const { v4: uuid } = require('uuid');
const { db } = require('../src/db/connection');
const presence = require('../src/realtime/presence');
const usersSvc = require('../src/modules/users/users.service');

function seedUser(id, username) {
  // wechat_id 有唯一索引（idx_users_wechat_id_unique），空字符串也算重复值，必须各不相同
  db.prepare('INSERT INTO users (id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)')
    .run(id, username, `1${id.slice(0, 10)}`, 'x', id.slice(0, 8));
}

// 模拟最后一台设备断开（同 realtime/index.js disconnect 分支）
function goOffline(userId, socketId) {
  if (presence.removeSocket(userId, socketId)) presence.cleanupUser(userId);
}

afterAll(async () => { await require('../src/db/writer').shutdown(); });

describe('presence 资料缓存：在线用户懒回填', () => {
  test('dropProfile 后在线用户 getProfile 返回 DB 最新资料（不是 {}）', () => {
    const id = uuid(), sid = `sock-${uuid()}`;
    seedUser(id, `pp-old-${id.slice(0, 8)}`);
    presence.addSocket(id, sid, 'web');
    try {
      presence.cacheProfile(id);
      expect(presence.getProfile(id).username).toBe(`pp-old-${id.slice(0, 8)}`);

      db.prepare('UPDATE users SET username=?, avatar=? WHERE id=?')
        .run(`pp-new-${id.slice(0, 8)}`, '/uploads/avatars/pp-new.png', id);
      presence.dropProfile(id);

      // 旧实现这里返回 {}，send_message 广播 senderName:'' / senderAvatar:''
      expect(presence.getProfile(id)).toEqual({
        username: `pp-new-${id.slice(0, 8)}`, avatar: '/uploads/avatars/pp-new.png',
      });
    } finally {
      goOffline(id, sid);
    }
  });

  test('真实路径：updateProfile / setAvatar 之后立即拿到新昵称、新头像', async () => {
    const id = uuid(), sid = `sock-${uuid()}`;
    seedUser(id, `pp-u0-${id.slice(0, 8)}`);
    presence.addSocket(id, sid, 'android');
    try {
      presence.cacheProfile(id);

      await usersSvc.updateProfile(id, { username: `pp-u1-${id.slice(0, 8)}` });
      expect(presence.getProfile(id).username).toBe(`pp-u1-${id.slice(0, 8)}`);

      // 仅改简介也会 dropProfile：昵称不能因此丢失
      await usersSvc.updateProfile(id, { bio: 'hello' });
      expect(presence.getProfile(id).username).toBe(`pp-u1-${id.slice(0, 8)}`);

      await usersSvc.setAvatar(id, '/uploads/avatars/pp-u1.png');
      expect(presence.getProfile(id)).toEqual({
        username: `pp-u1-${id.slice(0, 8)}`, avatar: '/uploads/avatars/pp-u1.png',
      });
    } finally {
      goOffline(id, sid);
    }
  });

  test('命中路径仍走缓存：未 dropProfile 时不会每次回表', () => {
    const id = uuid(), sid = `sock-${uuid()}`;
    seedUser(id, `pp-hit-${id.slice(0, 8)}`);
    presence.addSocket(id, sid, 'web');
    try {
      presence.cacheProfile(id);
      db.prepare('UPDATE users SET username=? WHERE id=?').run(`pp-hit2-${id.slice(0, 8)}`, id);
      // 没有 dropProfile → 仍是缓存里的旧值（证明命中路径没有退化成每次 SELECT）
      expect(presence.getProfile(id).username).toBe(`pp-hit-${id.slice(0, 8)}`);
    } finally {
      goOffline(id, sid);
    }
  });

  test('离线用户不回填缓存：返回 {}，上线后拿到的是最新资料而非离线时的旧值', () => {
    const id = uuid(), sid = `sock-${uuid()}`;
    seedUser(id, `pp-off-${id.slice(0, 8)}`);

    // 从未上线：维持旧行为返回 {}（callMessage/groupEvents 对离线用户本就如此）
    expect(presence.getProfile(id)).toEqual({});

    // 上线 → 断开（cleanupUser 清缓存）→ 离线期间不应再被回填
    presence.addSocket(id, sid, 'ios');
    presence.cacheProfile(id);
    expect(presence.getProfile(id).username).toBe(`pp-off-${id.slice(0, 8)}`);
    goOffline(id, sid);
    expect(presence.isOnline(id)).toBe(false);
    expect(presence.getProfile(id)).toEqual({});

    // 离线期间改名；若上面那次离线 getProfile 偷偷写进了 Map，这里会读到旧名
    db.prepare('UPDATE users SET username=? WHERE id=?').run(`pp-off2-${id.slice(0, 8)}`, id);
    const sid2 = `sock-${uuid()}`;
    presence.addSocket(id, sid2, 'ios');
    try {
      // 不调用 cacheProfile，靠 getProfile 懒回填
      expect(presence.getProfile(id).username).toBe(`pp-off2-${id.slice(0, 8)}`);
    } finally {
      goOffline(id, sid2);
    }
  });
});
