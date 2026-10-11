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
const { SEQUENCE_PARAM } = require('../../db/writer');
const { appendConversationEvent, emitSyncAvailable } = require('../../modules/messages/sync.service');
const presence = require('../presence');
const broadcaster = require('../broadcaster');
const { privateSendGuard } = require('../../modules/messages/shared');
const { guardPayload, guardId } = require('../guard');

// 防刷：同一发起者最短 3s 一次
const COOLDOWN_MS = 3000;
// 2026-10-11：冷却改为进程内同步 Map（审计：原 await cache.get → 校验 → await cache.set，
// 同一批到达的多个 nudge 包都在 set 落地前读到旧值而全部放行；Redis 未配置/故障期间
// get 恒为 null、set 静默跳过，冷却整体失效——10-07 Redis 宕机期间即是如此）。
// 生产为单进程 fork，进程内 Map 就是权威状态；检查与占用都在第一个 await 之前同步完成，
// 同一用户的并发包由事件循环串行判定，不存在竞态窗口。
const nudgeCooldown = new Map(); // userId → 上次占用冷却的时间戳(ms)
// 惰性清扫：距上次清扫满 SWEEP_INTERVAL_MS 才遍历一次删过期条目。不挂定时器（不拖住进程退出、
// 不干扰测试 fake timers），Map 规模只取决于最近一个清扫周期内拍过一拍的人数。
const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweepAt = 0;
function sweepExpiredCooldowns(now) {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [uid, ts] of nudgeCooldown) {
    if (now - ts >= COOLDOWN_MS) nudgeCooldown.delete(uid);
  }
}

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

  socket.on('nudge', async (payload, ack) => {
    // P0-002 强校验：负载必须是对象，conversationId 必须是合法字符串 ID
    const p = guardPayload(socket, 'nudge', payload);
    if (!p) { ack?.({ success: false, error: '参数缺失' }); return; }
    const conversationId = guardId(socket, 'nudge', 'conversationId', p.conversationId);
    if (!conversationId) { ack?.({ success: false, error: '参数缺失' }); return; }
    const targetId = typeof p.targetId === 'string' && p.targetId.length <= 64 ? p.targetId : null;
    try {
      if (!conversationId) { ack?.({ success: false, error: '参数缺失' }); return; }

      // 后台开关拦截：关闭「拍一拍」后，任何客户端（含绕过 UI 的直连）都被拒绝。
      // 直接读 admin_settings，避免引入 admin.service 造成循环依赖；实时生效，无需重启。
      if (readDb.prepare('SELECT value FROM admin_settings WHERE key=?').get('feature_nudge')?.value === 'off') {
        ack?.({ success: false, error: '管理员已关闭拍一拍功能' }); return;
      }

      // 2026-10-11：冷却 + 消息限流全程同步、在第一个 await 之前完成"检查并占用"（见 nudgeCooldown 注释），
      // 且先于下面的成员/会话/对象等 DB 查询：刷包被挡时不再每包打一串 readDb。
      // 先占用后校验成员/对象是有意的：无效拍一拍同样消耗冷却，顺带防探测。
      const now = Date.now();
      sweepExpiredCooldowns(now);
      const lastTs = nudgeCooldown.get(userId);
      if (lastTs !== undefined && now - lastTs < COOLDOWN_MS) {
        ack?.({ success: false, error: '操作过于频繁' }); return;
      }
      // 拍一拍同样落库 + 广播 + 触发全员 sync，与 send_message / send_file_message 共用
      // 每用户每秒消息预算；ack 形状与 message.js 一致，客户端可按 retryAfterMs 退避。
      // 放在占用冷却之前：被限流的这次并未发出，不应再白白吃掉 3s 冷却。
      const _rate = presence.checkMsgRate(userId);
      if (!_rate.ok) {
        ack?.({ success: false, error: '发送频率过高，请稍后再试', code: 'RATE_LIMITED', retryAfterMs: _rate.retryAfterMs });
        return;
      }
      nudgeCooldown.set(userId, now);

      // 发起者必须是会话成员
      const me = readDb.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?')
        .get(conversationId, userId);
      if (!me) { ack?.({ success: false, error: '非会话成员' }); return; }

      const conv = readDb.prepare('SELECT type, mute_all FROM conversations WHERE id=?').get(conversationId);
      if (!conv) { ack?.({ success: false, error: '会话不存在' }); return; }

      // 拍一拍同样是一条落库+广播的消息推送：与发消息路径一致做门控，防止绕过骚扰/禁言
      // 私聊：拉黑 / 屏蔽陌生人合并校验（复用已取的 conv，否则拉黑后仍可靠拍一拍骚扰对方）
      const guardReason = privateSendGuard(conversationId, userId, conv);
      if (guardReason) { ack?.({ success: false, error: guardReason }); return; }
      // 群聊全员禁言：普通成员不能借拍一拍在禁言期间刷屏
      if (conv.type !== 'private' && conv.mute_all && me.role === 'member') {
        ack?.({ success: false, error: '全员禁言中，您没有发言权限' }); return;
      }

      // 私聊：target 默认是对方；群聊：必须显式指定且为群成员
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

      const id = uuidv4();
      const created_at = Math.floor(now / 1000);
      const payload = {
        actor: userId,
        actorName: displayName(conversationId, userId),
        target,
        targetName: displayName(conversationId, target),
      };
      const content = JSON.stringify(payload);

      const sequenced = await appendConversationEvent({
        conversationId, eventType: 'message_created', messageId: id, actorId: userId,
        ops: [{ sql: `INSERT INTO messages (id,conversation_id,sender_id,type,content,reply_to_id,created_at,client_msg_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?)`,
          params: [id, conversationId, userId, 'nudge', content, null, created_at, null, SEQUENCE_PARAM] }],
      });

      const msg = {
        id, conversation_id: conversationId, sender_id: userId, type: 'nudge', content,
        file_url: '', reply_to_id: null, deleted: 0, edited: 0, created_at,
        senderName: payload.actorName, senderAvatar: presence.getProfile(userId).avatar || '',
        reactions: [], replyTo: null,
      };

      broadcaster.broadcastMessage(conversationId, msg);
      emitSyncAvailable(io, conversationId, sequenced.server_sequence);
      ack?.({ success: true, message: msg });
    } catch (err) {
      ack?.({ success: false, error: '服务器内部错误' });
    }
  });
};

// 供单测核验冷却 Map 的有界性（2026-10-11，见 test/perf-nudge.test.js）
module.exports.cooldownInternals = { nudgeCooldown, COOLDOWN_MS, SWEEP_INTERVAL_MS };
