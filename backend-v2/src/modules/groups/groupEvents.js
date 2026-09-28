'use strict';
/**
 * 群系统提示（微信行为对齐）：入群 / 邀请 / 移出 / 转让群主 / 改群名 / 全员禁言 / 设管理员时
 * 在群里写一条 type='system' 消息，各端渲染为居中灰字。此前这些事件在群里完全没有痕迹。
 *
 *  - content：中性人话。老客户端不认识 system 类型时按普通文本兜底显示，也能读懂。
 *  - file_url：结构化 JSON（与通话消息同样复用空置字段）
 *      { event, actorId, actorName, targets: [{ id, name }], name? }
 *    新端据此把「自己」渲染成「你」。
 *  - 系统消息不计未读、不触发推送、不进搜索（见 conversations.service / messages.service 与各端）。
 *
 * 写入失败只记日志：系统提示是体验增强，不影响群操作本身。
 */
const { v4: uuidv4 } = require('uuid');
const { readDb } = require('../../db/connection');
const { SEQUENCE_PARAM } = require('../../db/writer');

const MAX_NAMES = 10;

const TEXT = {
  invited:   (a, t) => `${a} 邀请 ${t} 加入了群聊`,
  joined:    (a) => `${a} 通过邀请链接加入了群聊`,
  removed:   (a, t) => `${a} 将 ${t} 移出了群聊`,
  owner:     (a, t) => `${a} 已将群主转让给 ${t}`,
  renamed:   (a, _t, x) => `${a} 修改群名为「${x.name}」`,
  mute_on:   (a) => `${a} 开启了全员禁言`,
  mute_off:  (a) => `${a} 关闭了全员禁言`,
  admin_on:  (a, t) => `${a} 将 ${t} 设为管理员`,
  admin_off: (a, t) => `${a} 取消了 ${t} 的管理员身份`,
};

const _name = readDb.prepare('SELECT username FROM users WHERE id=?');
const nameOf = id => _name.get(id)?.username || '';

function joinNames(targets) {
  const shown = targets.slice(0, MAX_NAMES).map(t => t.name).join('、');
  return targets.length > MAX_NAMES ? `${shown} 等 ${targets.length} 人` : shown;
}

async function writeGroupEvent(io, convId, event, actorId, targetIds = [], extra = {}) {
  try {
    if (!TEXT[event] || !convId || !actorId) return;
    const actorName = nameOf(actorId);
    const targets = targetIds.map(id => ({ id, name: nameOf(id) }));
    const content = TEXT[event](actorName, joinNames(targets), extra);
    const meta = JSON.stringify({ event, actorId, actorName, targets: targets.slice(0, 50), ...extra });

    // 懒加载：sync.service → messages 模块链路较长，避免与 groups.service 形成加载期循环依赖
    const { appendConversationEvent, emitSyncAvailable } = require('../messages/sync.service');
    const broadcaster = require('../../realtime/broadcaster');
    const presence = require('../../realtime/presence');

    const id = uuidv4();
    const created_at = Math.floor(Date.now() / 1000);
    const sequenced = await appendConversationEvent({
      conversationId: convId, eventType: 'message_created', messageId: id, actorId,
      ops: [{
        sql: 'INSERT INTO messages (id,conversation_id,sender_id,type,content,file_url,reply_to_id,created_at,client_msg_id,server_sequence) VALUES (?,?,?,?,?,?,?,?,?,?)',
        params: [id, convId, actorId, 'system', content, meta, null, created_at, null, SEQUENCE_PARAM],
      }],
    });
    const msg = {
      id, conversation_id: convId, sender_id: actorId, type: 'system', content, file_url: meta,
      reply_to_id: null, deleted: 0, edited: 0, created_at,
      senderName: presence.getProfile(actorId)?.username || actorName,
      senderAvatar: presence.getProfile(actorId)?.avatar || '',
      reactions: [], replyTo: null,
    };
    broadcaster.broadcastMessage(convId, msg);
    if (sequenced && io) emitSyncAvailable(io, convId, sequenced.server_sequence);
  } catch (e) {
    console.warn('[group-event] 写入群系统提示失败:', e.message);
  }
}

/** fire-and-forget：群操作接口不等待系统提示落库 */
function groupEvent(io, convId, event, actorId, targetIds, extra) {
  writeGroupEvent(io, convId, event, actorId, targetIds, extra).catch(() => {});
}

module.exports = { groupEvent, writeGroupEvent, GROUP_EVENT_TEXT: TEXT };
