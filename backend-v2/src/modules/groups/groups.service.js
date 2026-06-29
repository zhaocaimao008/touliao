'use strict';
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const { db } = require('../../db/connection');
const config = require('../../config');
const { badRequest, forbidden, notFound } = require('../../utils/http');
const { isMember, requireMember, memberRole, purgeConversation } = require('../messages/shared');

// ── 群昵称 ──────────────────────────────────────────────────────
function setNickname(io, convId, userId, nickname) {
  if (nickname && nickname.length > 30) throw badRequest('群昵称最长30字');
  requireMember(convId, userId, '不在群内');
  db.prepare('UPDATE conversation_members SET nickname=? WHERE conversation_id=? AND user_id=?')
    .run(nickname || null, convId, userId);
  if (io) io.to(convId).emit('group_updated', { id: convId });
  return nickname || null;
}

// ── 邀请链接 / 二维码 / 扫码进群 ────────────────────────────────
function createInviteLink(convId, userId) {
  requireMember(convId, userId, '不在群内');
  const token = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
  db.prepare('INSERT OR REPLACE INTO group_invite_tokens (token, conversation_id, created_by, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, convId, userId, expiresAt);
  return { token, url: `${config.appUrl}/join/${token}`, expiresAt };
}

async function getQrCode(convId, userId) {
  requireMember(convId, userId, '不在群内');
  let invite = db.prepare('SELECT token FROM group_invite_tokens WHERE conversation_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 1')
    .get(convId, Math.floor(Date.now() / 1000));
  if (!invite) {
    const token = uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    db.prepare('INSERT INTO group_invite_tokens (token,conversation_id,created_by,expires_at) VALUES (?,?,?,?)')
      .run(token, convId, userId, expiresAt);
    invite = { token };
  }
  const url = `${config.appUrl}/join/${invite.token}`;
  const qrCode = await QRCode.toDataURL(url, { width: 240, margin: 2, color: { dark: '#191919', light: '#ffffff' } });
  return { qrCode, url, token: invite.token };
}

function joinByToken(io, userId, token) {
  const invite = db.prepare('SELECT * FROM group_invite_tokens WHERE token=? AND expires_at>?')
    .get(token, Math.floor(Date.now() / 1000));
  if (!invite) throw notFound('邀请链接无效或已过期');

  if (isMember(invite.conversation_id, userId)) {
    return { success: true, conversationId: invite.conversation_id, alreadyMember: true };
  }
  const curCount = db.prepare('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id=?').get(invite.conversation_id).n;
  if (curCount >= config.limits.maxGroupMembers) throw badRequest(`群成员已达上限 ${config.limits.maxGroupMembers} 人`);
  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id,role) VALUES (?,?,?)')
    .run(invite.conversation_id, userId, 'member');
  const conv = db.prepare('SELECT id,type,name,avatar FROM conversations WHERE id=?').get(invite.conversation_id);
  if (io) {
    io.to(`user_${userId}`).emit('new_conversation', conv);
    io.to(invite.conversation_id).emit('group_updated', { id: invite.conversation_id });
  }
  return { success: true, conversationId: invite.conversation_id, conversation: conv };
}

// ── 群信息修改（群主/管理员）────────────────────────────────────
function updateInfo(io, convId, userId, { name, announcement }) {
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 50))
    throw badRequest('群名称长度为 1-50 字符');
  if (announcement !== undefined && typeof announcement === 'string' && announcement.length > 1000)
    throw badRequest('群公告最多 1000 字');

  const conv = db.prepare('SELECT * FROM conversations WHERE id=? AND type=?').get(convId, 'group');
  if (!conv) throw notFound('群不存在');
  const role = memberRole(convId, userId);
  if (!role) throw forbidden('不在群内');
  if (role === 'member') throw forbidden('仅群主和管理员可修改群信息');

  if (name !== undefined) db.prepare('UPDATE conversations SET name=? WHERE id=?').run(name.trim(), convId);
  if (announcement !== undefined) db.prepare('UPDATE conversations SET announcement=? WHERE id=?').run(announcement, convId);
  const updated = db.prepare('SELECT id, name, announcement, owner_id FROM conversations WHERE id=?').get(convId);
  if (io) io.to(convId).emit('group_updated', updated);
  return updated;
}

function setAvatar(io, convId, userId, url) {
  const role = memberRole(convId, userId);
  if (!role) throw forbidden('不在群内');
  if (role === 'member') throw forbidden('仅群主和管理员可修改群头像');
  db.prepare('UPDATE conversations SET avatar=? WHERE id=?').run(url, convId);
  if (io) io.to(convId).emit('group_updated', { id: convId, avatar: url });
  return url;
}

// ── 邀请成员 ────────────────────────────────────────────────────
function invite(io, convId, userId, userIds) {
  if (!userIds?.length) throw badRequest('参数缺失');
  requireMember(convId, userId, '不在群内');
  const add = db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id,user_id) VALUES (?,?)');
  const added = [];
  // 一次批量查询校验用户是否存在，避免 N+1
  const ph = userIds.map(() => '?').join(',');
  const validSet = new Set(db.prepare(`SELECT id FROM users WHERE id IN (${ph})`).all(userIds).map(r => r.id));
  userIds.forEach(uid => {
    if (!validSet.has(uid)) return;
    if (add.run(convId, uid).changes > 0) added.push(uid);
  });
  if (io && added.length > 0) {
    const conv = db.prepare('SELECT id,type,name,avatar FROM conversations WHERE id=?').get(convId);
    added.forEach(uid => {
      io.to(`user_${uid}`).emit('new_conversation', conv);
      io.to(`user_${uid}`).emit('group_member_added', { conversationId: convId, userId: uid });
    });
    io.to(convId).emit('group_updated', { id: convId });
  }
  return added.length;
}

// ── 移除成员（群主可踢任何人，管理员可踢普通成员）── R2 修复：强制被踢者全端离开房间
function kick(io, convId, callerId, uid) {
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(convId);
  if (!conv) throw notFound('群不存在');
  const callerRole = memberRole(convId, callerId);
  if (!callerRole || callerRole === 'member') throw forbidden('无权操作，仅群主或管理员可移除成员');
  if (uid === callerId) throw badRequest('不能移除自己');
  const targetRole = memberRole(convId, uid);
  if (!targetRole) throw notFound('成员不存在');
  if (callerRole === 'admin' && targetRole !== 'member') throw forbidden('管理员只能移除普通成员');

  db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(convId, uid);
  if (io) {
    io.in(`user_${uid}`).socketsLeave(convId);
    io.to(convId).emit('group_updated', { id: convId });
    io.to(`user_${uid}`).emit('group_kicked', { conversationId: convId });
  }
}

// ── 退群（非群主专用）────────────────────────────────────────────
// 群主不可直接退群：必须先转让群主，成为普通成员后再退；或调 dissolve 解散。
function leave(io, convId, userId) {
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(convId);
  if (!conv) throw notFound('群不存在');
  if (conv.owner_id === userId) throw badRequest('群主不能直接退出群聊，请先转让群主后再退出，或解散群聊');
  db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(convId, userId);
  if (io) io.to(convId).emit('group_updated', { id: convId });
}

// ── 解散群聊（仅群主）────────────────────────────────────────────
function dissolve(io, convId, userId) {
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(convId);
  if (!conv) throw notFound('群不存在');
  if (conv.owner_id !== userId) throw forbidden('仅群主可解散群聊');
  purgeConversation(convId);
  if (io) io.to(convId).emit('group_dismissed', { conversationId: convId });
}

// ── 群详情 ──────────────────────────────────────────────────────
function info(convId, userId) {
  const myRole = memberRole(convId, userId);
  if (!myRole) throw forbidden('不在群内');
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(convId);
  if (!conv) throw notFound('群不存在');
  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar, u.bio, cm.role, cm.nickname
    FROM users u JOIN conversation_members cm ON cm.user_id=u.id
    WHERE cm.conversation_id=?
    ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.username
  `).all(convId);
  return { ...conv, members, myRole };
}

// ── 群管理设置（禁止私聊/全员禁言/禁止互加）──────────────────────
function manage(io, convId, userId, body) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id=? AND type=?').get(convId, 'group');
  if (!conv) throw notFound('群不存在');
  const role = memberRole(convId, userId);
  if (!role || role === 'member') throw forbidden('无权操作，仅群主或管理员可修改');

  const updates = [], params = [];
  const { no_private_chat, mute_all, no_add_friend } = body;
  if (no_private_chat !== undefined) { updates.push('no_private_chat=?'); params.push(no_private_chat ? 1 : 0); }
  if (mute_all !== undefined) { updates.push('mute_all=?'); params.push(mute_all ? 1 : 0); }
  if (no_add_friend !== undefined) { updates.push('no_add_friend=?'); params.push(no_add_friend ? 1 : 0); }
  if (updates.length === 0) throw badRequest('无有效参数');

  params.push(convId);
  db.prepare(`UPDATE conversations SET ${updates.join(',')} WHERE id=?`).run(...params);
  const updated = db.prepare('SELECT id, no_private_chat, mute_all, no_add_friend FROM conversations WHERE id=?').get(convId);
  if (io) io.to(convId).emit('group_settings_updated', updated);
  return updated;
}

// ── 设置/取消管理员（仅群主）────────────────────────────────────
// 转让群主：当前群主 → newOwnerId（新群主），原群主降为普通成员
function transferOwner(io, convId, ownerId, newOwnerId) {
  if (!newOwnerId) throw badRequest('参数缺失');
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(convId);
  if (!conv) throw notFound('群不存在');
  if (conv.owner_id !== ownerId) throw forbidden('仅群主可转让');
  if (newOwnerId === ownerId) throw badRequest('不能转让给自己');
  const target = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, newOwnerId);
  if (!target) throw notFound('成员不存在');

  db.transaction(() => {
    db.prepare('UPDATE conversations SET owner_id=? WHERE id=?').run(newOwnerId, convId);
    db.prepare("UPDATE conversation_members SET role='owner' WHERE conversation_id=? AND user_id=?").run(convId, newOwnerId);
    db.prepare("UPDATE conversation_members SET role='member' WHERE conversation_id=? AND user_id=?").run(convId, ownerId);
  })();

  if (io) {
    io.to(convId).emit('group_updated', { id: convId, owner_id: newOwnerId });
    io.to(`user_${newOwnerId}`).emit('role_changed', { conversationId: convId, role: 'owner' });
    io.to(`user_${ownerId}`).emit('role_changed', { conversationId: convId, role: 'member' });
  }
}

function setRole(io, convId, ownerId, uid, role) {
  if (!['admin', 'member'].includes(role)) throw badRequest('无效角色');
  const conv = db.prepare('SELECT owner_id FROM conversations WHERE id=?').get(convId);
  if (!conv) throw notFound('群不存在');
  if (conv.owner_id !== ownerId) throw forbidden('仅群主可设置管理员');
  if (uid === ownerId) throw badRequest('不能修改自己的角色');
  const target = db.prepare('SELECT role FROM conversation_members WHERE conversation_id=? AND user_id=?').get(convId, uid);
  if (!target) throw notFound('成员不存在');
  if (target.role === 'owner') throw badRequest('不能修改群主角色');

  db.prepare('UPDATE conversation_members SET role=? WHERE conversation_id=? AND user_id=?').run(role, convId, uid);
  if (io) {
    io.to(convId).emit('group_updated', { id: convId });
    io.to(`user_${uid}`).emit('role_changed', { conversationId: convId, role });
  }
}

// ── 置顶消息 ────────────────────────────────────────────────────
function pinMessage(io, convId, userId, msgId) {
  if (!msgId) throw badRequest('参数缺失');
  requireMember(convId, userId, '不在会话中');
  const role = memberRole(convId, userId);
  if (role === 'member') throw forbidden('仅群主和管理员可置顶消息');
  const msg = db.prepare('SELECT id,type,content,sender_id FROM messages WHERE id=? AND conversation_id=?').get(msgId, convId);
  if (!msg) throw notFound('消息不存在');
  db.prepare('INSERT OR REPLACE INTO pinned_messages (id,conversation_id,message_id,pinned_by) VALUES (?,?,?,?)')
    .run(uuidv4(), convId, msgId, userId);
  const pinner = db.prepare('SELECT username FROM users WHERE id=?').get(userId);
  if (io) io.to(convId).emit('message_pinned', { msgId, convId, pinnedBy: pinner?.username, content: msg.content, type: msg.type });
}

function unpinMessage(io, convId, userId, msgId) {
  requireMember(convId, userId, '不在会话中');
  const role = memberRole(convId, userId);
  if (role === 'member') throw forbidden('仅群主和管理员可取消置顶');
  db.prepare('DELETE FROM pinned_messages WHERE conversation_id=? AND message_id=?').run(convId, msgId);
  if (io) io.to(convId).emit('message_unpinned', { msgId, convId });
}

function listPinned(convId, userId) {
  requireMember(convId, userId);
  return db.prepare(`
    SELECT pm.message_id as msgId, pm.pinned_by, pm.created_at,
      m.type, m.content, m.file_url, u.username as senderName, pu.username as pinnedByName
    FROM pinned_messages pm
    JOIN messages m ON m.id=pm.message_id
    JOIN users u ON u.id=m.sender_id
    JOIN users pu ON pu.id=pm.pinned_by
    WHERE pm.conversation_id=? ORDER BY pm.created_at DESC LIMIT 20
  `).all(convId);
}

module.exports = {
  setNickname, createInviteLink, getQrCode, joinByToken,
  updateInfo, setAvatar, invite, kick, leave, dissolve, info, manage, setRole, transferOwner,
  pinMessage, unpinMessage, listPinned,
};
