'use strict';
/**
 * 拍一拍（nudge）：双击对方头像，向会话广播一条 type='nudge' 的系统消息并落库。
 * 复用消息基础设施——落 messages 表 → 进历史、三端同步；广播走 broadcaster。
 *
 * content 存 JSON：{ actor, actorName, target, targetName }，
 * 客户端据此渲染「你 拍了拍 X」/「X 拍了拍 你」/「X 拍了拍 Y」。
 */
const { v4: uuidv4 } = require('uuid');
const { readDb } = require('../../db/connection');
const { writeAsync } = require('../../db/writer');
const presence = require('../presence');
const broadcaster = require('../broadcaster');
const cache = require('../../utils/cache');

// 防刷：同一发起者最短 3s 一次（使用 cache 层跨进程共享，防 PM2 cluster 绕过）
const COOLDOWN_MS = 3000;
const COOLDOWN_S = Math.ceil(COOLDOWN_MS / 1000);

// 群里优先用群昵称，否则用户名
function displayName(conversationId, userId) {
  const m = readDb.prepare('SELECT nickname FROM conversation_members WHERE conversation_id=? AND user_id=?')
    .get(conversationId, userId);
  if (m?.nickname) return m.nickname;
  const u = readDb.prepare('SELECT username FROM users WHERE id=?').get(userId);
  return u?.username || '';
}

module.exports = function registerNudgeHandler(io, socket) {
  const userId = socket.user.id;

  socket.on('nudge', async ({ conversationId, targetId } = {}, ack) => {
    try {
      if (!conversationId) { ack?.({ success: false, error: '参数缺失' }); return; }

      // 冷却（cache 跨进程共享，防 PM2 cluster 模式绕过）
      const cdKey = `nudge:cd:${userId}`;
      const lastTs = await cache.get(cdKey);
      const now = Date.now();
      if (lastTs && now - parseInt(lastTs) < COOLDOWN_MS) {
        ack?.({ success: false, error: '操作过于频繁' }); return;
      }

      // 发起者必须是会话成员
      const me = readDb.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?')
        .get(conversationId, userId);
      if (!me) { ack?.({ success: false, error: '非会话成员' }); return; }

      // 私聊：target 默认是对方；群聊：必须显式指定且为群成员
      const conv = readDb.prepare('SELECT type FROM conversations WHERE id=?').get(conversationId);
      if (!conv) { ack?.({ success: false, error: '会话不存在' }); return; }

      let target = targetId;
      if (conv.type === 'private') {
        if (!target) {
          target = readDb.prepare(
            'SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id!=? LIMIT 1'
          ).get(conversationId, userId)?.user_id;
        }
      }
      if (!target) { ack?.({ success: false, error: '缺少拍一拍对象' }); return; }
      const targetIsMember = readDb.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?')
        .get(conversationId, target);
      if (!targetIsMember) { ack?.({ success: false, error: '对象不在会话内' }); return; }

      await cache.set(cdKey, String(now), COOLDOWN_S);

      const id = uuidv4();
      const created_at = Math.floor(now / 1000);
      const payload = {
        actor: userId,
        actorName: displayName(conversationId, userId),
        target,
        targetName: displayName(conversationId, target),
      };
      const content = JSON.stringify(payload);

      await writeAsync(
        `INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id) VALUES (?,?,?,?,?,?,?,?)`,
                [id, conversationId, userId, 'nudge', content, null, created_at, null]
      );

      const msg = {
        id, conversation_id: conversationId, sender_id: userId, type: 'nudge', content,
        file_url: '', reply_to_id: null, deleted: 0, edited: 0, created_at,
        senderName: payload.actorName, senderAvatar: presence.getProfile(userId).avatar || '',
        reactions: [], replyTo: null,
      };

      broadcaster.broadcastMessage(conversationId, msg);
      ack?.({ success: true, message: msg });
    } catch (err) {
      ack?.({ success: false, error: '服务器内部错误' });
    }
  });
};
