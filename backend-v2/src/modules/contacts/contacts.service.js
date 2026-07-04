'use strict';
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const { badRequest, forbidden, notFound } = require('../../utils/http');
const usersSvc = require('../users/users.service');
const { getOrCreatePrivate } = require('../conversations/conversations.service');

// ── 联系人 ──────────────────────────────────────────────────────
function listContacts(userId) {
  // 隐私：不返回 phone（S3 修复保留）
  return db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, u.status, u.wechat_id, c.remark
    FROM contacts c JOIN users u ON u.id = c.contact_id
    WHERE c.user_id = ?
    ORDER BY COALESCE(c.remark, u.username) COLLATE NOCASE
    LIMIT 1000
  `).all(userId);
}

function deleteContact(userId, contactId) {
  // 同步删除双向记录：A删除B后，B不再能通过好友关系查看A的私密朋友圈。
  // 一并清理双方好友标签成员关系，避免删除后再加回时残留旧标签分组（脏数据 + 越权可见风险）。
  db.transaction(() => {
    db.prepare('DELETE FROM contacts WHERE (user_id=? AND contact_id=?) OR (user_id=? AND contact_id=?)')
      .run(userId, contactId, contactId, userId);
    db.prepare(`
      DELETE FROM friend_label_members
      WHERE (friend_id=? AND label_id IN (SELECT id FROM friend_labels WHERE user_id=?))
         OR (friend_id=? AND label_id IN (SELECT id FROM friend_labels WHERE user_id=?))
    `).run(contactId, userId, userId, contactId);
  })();
}

function setRemark(userId, contactId, remark) {
  const safeRemark = typeof remark === 'string' ? remark.trim() : '';
  if (safeRemark.length > 20) throw badRequest('备注最长 20 个字符');
  const r = db.prepare('UPDATE contacts SET remark=? WHERE user_id=? AND contact_id=?').run(safeRemark, userId, contactId);
  if (r.changes === 0) throw notFound('联系人不存在');
}

// ── 好友请求 ────────────────────────────────────────────────────
// 返回 { result, sideEffects } —— controller 负责 io.emit（service 不碰 io）
function sendFriendRequest(io, fromId, { toId, message }) {
  if (!toId) throw badRequest('参数缺失');
  if (message && message.length > 100) throw badRequest('验证消息最长 100 个字符');
  if (toId === fromId) throw badRequest('不能添加自己');
  if (!db.prepare('SELECT id FROM users WHERE id=?').get(toId)) throw notFound('用户不存在');
  if (db.prepare('SELECT id FROM contacts WHERE user_id=? AND contact_id=?').get(fromId, toId)) throw badRequest('已是好友');
  if (db.prepare('SELECT 1 FROM blocked_users WHERE user_id=? AND blocked_id=?').get(toId, fromId)) throw forbidden('对方已将你加入黑名单');
  if (db.prepare('SELECT id FROM friend_requests WHERE from_id=? AND to_id=? AND status=?').get(fromId, toId, 'pending')) throw badRequest('请求已发送');
  // no_add_friend 检查必须在反向请求处理之前，防止绕过群限制
  const restricted = db.prepare(`
    SELECT c.name FROM conversation_members cm1
    JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
    JOIN conversations c ON c.id = cm1.conversation_id
    WHERE cm1.user_id = ? AND cm2.user_id = ? AND c.no_add_friend = 1
    LIMIT 1
  `).get(fromId, toId);
  if (restricted) throw forbidden(`「${restricted.name}」已开启"禁止群成员互相添加好友"`);

  // 对方已有 pending 请求 → 直接互接，避免双向 pending 共存
  const reverseReq = db.prepare('SELECT id FROM friend_requests WHERE from_id=? AND to_id=? AND status=?').get(toId, fromId, 'pending');
  if (reverseReq) return handleRequest(io, fromId, reverseReq.id, 'accepted');

  const targetSettings = usersSvc.serializeSettings(usersSvc.ensureSettings(toId));

  // 免验证：直接互加（事务保证两条 INSERT 原子完成，避免单向联系人）
  if (!targetSettings.requireVerify) {
    db.transaction(() => {
      const add = db.prepare('INSERT OR IGNORE INTO contacts (id,user_id,contact_id) VALUES (?,?,?)');
      add.run(uuidv4(), fromId, toId);
      add.run(uuidv4(), toId, fromId);
    })();
    const sender = db.prepare('SELECT id,username,avatar,wechat_id FROM users WHERE id=?').get(fromId);
    const target = db.prepare('SELECT id,username,avatar FROM users WHERE id=?').get(toId);
    const { conversationId } = getOrCreatePrivate(fromId, toId, { internal: true });
    if (io) io.to(`user_${toId}`).emit('friend_request_accepted', { accepter: sender, autoAccepted: true });
    if (io) {
      // 在线双方全端即时入新私聊房间，否则首条消息只广播到房间、要等重连才能实时收到。
      io.in(`user_${fromId}`).socketsJoin(conversationId);
      io.in(`user_${toId}`).socketsJoin(conversationId);
      const convForSender = { id: conversationId, type: 'private', name: target?.username || '', avatar: target?.avatar || '', pinned: 0, muted: 0, lastMessage: '', lastMessageType: '', lastTime: 0 };
      const convForTarget = { id: conversationId, type: 'private', name: sender?.username || '', avatar: sender?.avatar || '', pinned: 0, muted: 0, lastMessage: '', lastMessageType: '', lastTime: 0 };
      io.to(`user_${fromId}`).emit('new_conversation', convForSender);
      io.to(`user_${toId}`).emit('new_conversation', convForTarget);
    }
    return { success: true, autoAccepted: true };
  }

  const id = uuidv4();
  let inserted = false;
  db.transaction(() => {
    if (db.prepare('SELECT id FROM friend_requests WHERE from_id=? AND to_id=? AND status=?').get(fromId, toId, 'pending')) return;
    db.prepare('INSERT INTO friend_requests (id,from_id,to_id,message) VALUES (?,?,?,?)').run(id, fromId, toId, message || '');
    inserted = true;
  })();
  if (!inserted) throw badRequest('请求已发送');
  const sender = db.prepare('SELECT id,username,avatar,wechat_id FROM users WHERE id=?').get(fromId);
  if (io) io.to(`user_${toId}`).emit('new_friend_request', { id, from: sender, message: message || '' });
  return { success: true, id };
}

function listReceivedRequests(userId) {
  // 隐私：不返回 phone
  return db.prepare(`
    SELECT fr.id, fr.from_id, fr.to_id, fr.message, fr.status, fr.created_at,
           u.username, u.avatar, u.wechat_id
    FROM friend_requests fr JOIN users u ON u.id = fr.from_id
    WHERE fr.to_id=? AND fr.status='pending'
    ORDER BY fr.created_at DESC LIMIT 200
  `).all(userId);
}

function listSentRequests(userId) {
  return db.prepare(`
    SELECT fr.id, fr.status, fr.message, fr.created_at,
           u.id as toId, u.username, u.avatar, u.wechat_id
    FROM friend_requests fr JOIN users u ON u.id = fr.to_id
    WHERE fr.from_id=?
    ORDER BY fr.created_at DESC LIMIT 50
  `).all(userId);
}

function handleRequest(io, userId, requestId, action) {
  // 兼容移动端历史写法 accept/reject(安卓 ContactRepository.kt、iOS ContactRepository.swift
  // 发的是 accept/reject)，归一化为 DB 状态值 accepted/rejected，使存量 App 无需重发版即可加好友。
  if (action === 'accept') action = 'accepted';
  else if (action === 'reject') action = 'rejected';
  if (!['accepted', 'rejected'].includes(action)) throw badRequest('无效操作');
  const request = db.prepare("SELECT * FROM friend_requests WHERE id=? AND to_id=? AND status='pending'").get(requestId, userId);
  if (!request) throw notFound('请求不存在');
  // 接受侧门控复查（与 sendFriendRequest 判定口径对齐）：请求从发出到被接受之间存在时间窗，
  // 期间任一方可能拉黑对方、或来源群开启"禁止群成员互加"。此时不应再建立好友关系。
  // 仅在 action='accepted' 时复查（拒绝请求无需门控）。
  if (action === 'accepted') {
    // 已是好友：幂等，直接放行（沿用 sendFriendRequest 里 INSERT OR IGNORE 的宽松处理，不视为错误）
    // 黑名单：双向复查——任一方拉黑对方都拒绝建立好友（比 send 侧更严，覆盖接受方在期间拉黑请求方的场景）
    const blocked = db.prepare('SELECT user_id FROM blocked_users WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?)')
      .get(request.to_id, request.from_id, request.from_id, request.to_id);
    if (blocked) {
      // 接受方(userId=request.to_id)拉黑了请求方 → 提示自己先移出黑名单；否则请求方拉黑了你 → 沿用 send 侧文案
      throw forbidden(blocked.user_id === request.to_id ? '你已将对方加入黑名单，移出后才能添加' : '对方已将你加入黑名单');
    }
    // 来源群"禁止群成员互加"：与 send 侧同一判定（双方共处某群且该群 no_add_friend=1）
    const restricted = db.prepare(`
      SELECT c.name FROM conversation_members cm1
      JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
      JOIN conversations c ON c.id = cm1.conversation_id
      WHERE cm1.user_id = ? AND cm2.user_id = ? AND c.no_add_friend = 1
      LIMIT 1
    `).get(request.from_id, request.to_id);
    if (restricted) throw forbidden(`「${restricted.name}」已开启"禁止群成员互相添加好友"`);
  }
  db.transaction(() => {
    db.prepare('UPDATE friend_requests SET status=? WHERE id=?').run(action, requestId);
    if (action === 'accepted') {
      const add = db.prepare('INSERT OR IGNORE INTO contacts (id,user_id,contact_id) VALUES (?,?,?)');
      add.run(uuidv4(), request.from_id, request.to_id);
      add.run(uuidv4(), request.to_id, request.from_id);
    }
  })();
  if (action === 'accepted') {
    const accepter = db.prepare('SELECT id,username,avatar FROM users WHERE id=?').get(userId);
    const requester = db.prepare('SELECT id,username,avatar FROM users WHERE id=?').get(request.from_id);
    // 创建私聊会话
    const { conversationId } = getOrCreatePrivate(request.from_id, request.to_id, { internal: true });
    // 通知请求方好友已通过（带 accepter 信息，用于弹通知）
    if (io) io.to(`user_${request.from_id}`).emit('friend_request_accepted', { accepter });
    // 通知接受方自己（不带 accepter 信息，仅触发通讯录刷新，不弹"对方通过了你"提示）
    if (io) io.to(`user_${userId}`).emit('friend_request_accepted', { newFriend: requester });
    // 双方都收到 new_conversation 事件（自动置顶到会话列表）
    if (io) {
      // 在线双方全端即时入新私聊房间，否则首条消息只广播到房间、要等重连才能实时收到。
      io.in(`user_${userId}`).socketsJoin(conversationId);
      io.in(`user_${request.from_id}`).socketsJoin(conversationId);
      const convForAccepter = { id: conversationId, type: 'private', name: requester?.username || '', avatar: requester?.avatar || '', pinned: 0, muted: 0, lastMessage: '', lastMessageType: '', lastTime: 0 };
      const convForRequester = { id: conversationId, type: 'private', name: accepter?.username || '', avatar: accepter?.avatar || '', pinned: 0, muted: 0, lastMessage: '', lastMessageType: '', lastTime: 0 };
      io.to(`user_${userId}`).emit('new_conversation', convForAccepter);
      io.to(`user_${request.from_id}`).emit('new_conversation', convForRequester);
    }
  }
  return { success: true };
}

// ── 黑名单 ──────────────────────────────────────────────────────
function block(userId, targetId) {
  if (!db.prepare('SELECT id FROM users WHERE id=?').get(targetId)) throw notFound('用户不存在');
  if (targetId === userId) throw badRequest('不能拉黑自己');
  try {
    db.prepare('INSERT INTO blocked_users (id,user_id,blocked_id) VALUES (?,?,?)').run(uuidv4(), userId, targetId);
  } catch (e) {
    if (!e.message?.includes('UNIQUE')) { console.error('[block] 操作失败:', e.message); throw new Error('操作失败，请重试'); }
  }
}

function unblock(userId, targetId) {
  db.prepare('DELETE FROM blocked_users WHERE user_id=? AND blocked_id=?').run(userId, targetId);
}

function listBlocked(userId) {
  return db.prepare(`
    SELECT u.id, u.username, u.avatar FROM blocked_users b
    JOIN users u ON u.id=b.blocked_id WHERE b.user_id=? LIMIT 500
  `).all(userId);
}

module.exports = {
  listContacts, deleteContact, setRemark,
  sendFriendRequest, listReceivedRequests, listSentRequests, handleRequest,
  block, unblock, listBlocked,
};
