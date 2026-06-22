'use strict';
/**
 * 朋友圈 / Moments 业务层。
 *   - 时间线：本人 + 好友的动态，按可见性过滤
 *   - 点赞用 moment_likes 表（非 moments.likes JSON 旧字段）
 *   - 评论支持 reply_to_user
 * 可见性 visibility：all / friends（均需好友关系）/ private（仅本人）
 */
const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const config = require('../../config');
const { pushToUser } = require('../../utils/push');
const { badRequest, forbidden, notFound, conflict, paginated } = require('../../utils/http');

// ── 互动通知（MO2）：actor≠author 才记。删动态由 FK ON DELETE CASCADE 清理 ──
function addInteractNotification({ recipientId, actorId, momentId, type, commentId = null }) {
  if (recipientId === actorId) return;
  db.prepare('INSERT INTO moment_notifications (id,user_id,actor_id,moment_id,type,comment_id) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), recipientId, actorId, momentId, type, commentId);
  if (!config.moments.pushOnInteract) return;
  const actor = db.prepare('SELECT username FROM users WHERE id=?').get(actorId);
  const name = actor?.username || '有人';
  const body = type === 'like' ? `${name} 赞了你的朋友圈` : `${name} 评论了你的朋友圈`;
  // 离线推送 best-effort，不阻塞、不抛错
  pushToUser(recipientId, { title: '朋友圈', senderName: '朋友圈', body, type: 'moment', momentId }).catch(() => {});
}

function isFriend(viewerId, authorId) {
  return !!db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(viewerId, authorId);
}

// MO6：拉黑双向门控——任一方拉黑了对方，朋友圈互不可见
function isBlockedBetween(a, b) {
  return !!db.prepare(
    'SELECT 1 FROM blocked_users WHERE (user_id=? AND blocked_id=?) OR (user_id=? AND blocked_id=?) LIMIT 1'
  ).get(a, b, b, a);
}

// 可见性门控：本人可见全部；他人需好友、非 private、且双方无拉黑
function assertVisible(viewerId, m) {
  if (m.user_id === viewerId) return;
  if (isBlockedBetween(viewerId, m.user_id)) throw forbidden('无权查看该动态');
  if (m.visibility === 'private') throw forbidden('无权查看该动态');
  if (!isFriend(viewerId, m.user_id)) throw forbidden('无权查看该动态');
}

// 单条动态装配（作者、图片、点赞、评论、本人是否已赞）
function enrich(viewerId, m) {
  const author = db.prepare('SELECT id, username, avatar FROM users WHERE id=?').get(m.user_id);
  const likes = db.prepare(
    'SELECT ml.user_id, u.username FROM moment_likes ml JOIN users u ON u.id=ml.user_id WHERE ml.moment_id=? ORDER BY ml.created_at'
  ).all(m.id);
  const comments = db.prepare(
    'SELECT mc.id, mc.user_id, mc.content, mc.reply_to_user, mc.created_at, u.username, u.avatar FROM moment_comments mc JOIN users u ON u.id=mc.user_id WHERE mc.moment_id=? ORDER BY mc.created_at'
  ).all(m.id);
  return {
    ...m,
    images: JSON.parse(m.images || '[]'),
    author,
    likes,
    likeCount: likes.length,
    liked: likes.some(l => l.user_id === viewerId),
    comments,
    commentCount: comments.length,
  };
}

// ── 发布 ────────────────────────────────────────────────────────
function createMoment(io, userId, { content, images, visibility }) {
  const text = (content || '').trim();
  const imgs = Array.isArray(images) ? images.slice(0, 9) : [];
  if (!text && imgs.length === 0) throw badRequest('内容不能为空');
  if (text.length > 5000) throw badRequest('内容过长');
  const vis = ['all', 'friends', 'private'].includes(visibility) ? visibility : 'all';

  const id = uuidv4();
  db.prepare('INSERT INTO moments (id,user_id,content,images,visibility) VALUES (?,?,?,?,?)')
    .run(id, userId, text, JSON.stringify(imgs), vis);

  if (io && vis !== 'private') {
    const friends = db.prepare('SELECT contact_id FROM contacts WHERE user_id=?').all(userId);
    if (friends.length) io.to(friends.map(f => `user_${f.contact_id}`)).emit('new_moment', { momentId: id, userId });
  }
  return enrich(userId, db.prepare('SELECT * FROM moments WHERE id=?').get(id));
}

// ── 时间线（本人 + 好友）────────────────────────────────────────
function timeline(viewerId, { limit = 20, offset = 0 } = {}) {
  const n = Math.min(Number(limit) || 20, 50);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = db.prepare(`
    SELECT m.* FROM moments m
    WHERE (m.user_id=? OR m.user_id IN (SELECT contact_id FROM contacts WHERE user_id=?))
      AND (m.visibility != 'private' OR m.user_id=?)
      -- MO6：排除我拉黑的人 / 拉黑我的人的动态（本人动态不受影响）
      AND (m.user_id=? OR m.user_id NOT IN (
        SELECT blocked_id FROM blocked_users WHERE user_id=?
        UNION SELECT user_id FROM blocked_users WHERE blocked_id=?
      ))
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, n, off);
  return rows.map(m => enrich(viewerId, m));
}

// ── 某用户的动态（好友或本人）──────────────────────────────────
function userMoments(viewerId, targetId) {
  if (targetId !== viewerId && isBlockedBetween(viewerId, targetId)) throw forbidden('无权查看该动态');
  if (targetId !== viewerId && !isFriend(viewerId, targetId)) throw forbidden('仅好友可见');
  const rows = db.prepare(`
    SELECT * FROM moments
    WHERE user_id=? AND (
      visibility='all'
      OR (visibility='friends' AND ? IN (SELECT contact_id FROM contacts WHERE user_id=?))
      OR user_id=?
    )
    ORDER BY created_at DESC LIMIT 50
  `).all(targetId, viewerId, targetId, viewerId);
  return rows.map(m => enrich(viewerId, m));
}

// ── 单条动态详情（本人或可见好友）──────────────────────────────
function getMoment(viewerId, momentId) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  assertVisible(viewerId, m);
  return enrich(viewerId, m);
}

// ── 删除动态（仅作者，级联清理点赞/评论）──────────────────────
function deleteMoment(userId, momentId) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  if (m.user_id !== userId) throw forbidden('只能删除自己的动态');
  db.transaction(() => {
    db.prepare('DELETE FROM moment_comments WHERE moment_id=?').run(momentId);
    db.prepare('DELETE FROM moment_likes WHERE moment_id=?').run(momentId);
    db.prepare('DELETE FROM moments WHERE id=?').run(momentId);
  })();
  return { success: true };
}

// ── 点赞 / 取消（toggle）───────────────────────────────────────
function toggleLike(io, userId, momentId) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  assertVisible(userId, m);
  const existing = db.prepare('SELECT 1 FROM moment_likes WHERE moment_id=? AND user_id=?').get(momentId, userId);
  let liked;
  if (existing) {
    db.prepare('DELETE FROM moment_likes WHERE moment_id=? AND user_id=?').run(momentId, userId);
    liked = false;
    // 取消赞：默认保留通知（历史记录）；配置开启时才删
    if (config.moments.deleteNotifOnCancel) {
      db.prepare("DELETE FROM moment_notifications WHERE moment_id=? AND actor_id=? AND type='like'").run(momentId, userId);
    }
  } else {
    db.prepare('INSERT INTO moment_likes (moment_id,user_id) VALUES (?,?)').run(momentId, userId);
    liked = true;
    if (io && m.user_id !== userId) io.to(`user_${m.user_id}`).emit('moment_liked', { momentId, userId });
    addInteractNotification({ recipientId: m.user_id, actorId: userId, momentId, type: 'like' });
  }
  const likeCount = db.prepare('SELECT COUNT(*) AS n FROM moment_likes WHERE moment_id=?').get(momentId).n;
  return { liked, likeCount };
}

// ── 评论 ────────────────────────────────────────────────────────
function addComment(io, userId, momentId, { content, replyToUser }) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  assertVisible(userId, m);
  const text = (content || '').trim();
  if (!text) throw badRequest('评论不能为空');
  if (text.length > 500) throw badRequest('评论过长');

  // MO4：reply_to_user 必须是真实存在的 userId（此前存任意字符串、无校验）
  let replyTo = '';
  if (replyToUser) {
    if (typeof replyToUser !== 'string' || !db.prepare('SELECT 1 FROM users WHERE id=?').get(replyToUser)) {
      throw badRequest('回复对象不存在');
    }
    replyTo = replyToUser;
  }

  const id = uuidv4();
  db.prepare('INSERT INTO moment_comments (id,moment_id,user_id,content,reply_to_user) VALUES (?,?,?,?,?)')
    .run(id, momentId, userId, text, replyTo);
  if (io && m.user_id !== userId) io.to(`user_${m.user_id}`).emit('moment_commented', { momentId, userId });
  addInteractNotification({ recipientId: m.user_id, actorId: userId, momentId, type: 'comment', commentId: id });
  return db.prepare(
    'SELECT mc.id, mc.user_id, mc.content, mc.reply_to_user, mc.created_at, u.username, u.avatar FROM moment_comments mc JOIN users u ON u.id=mc.user_id WHERE mc.id=?'
  ).get(id);
}

// ── 点赞 / 评论分页列表（MO3）──────────────────────────────────
// enrich 一次性全查点赞/评论，热门动态评论多时开销大；提供独立分页接口。
// 均走 assertVisible 门控，返回 { items, total, hasMore }（新列表契约）。
function listLikes(viewerId, momentId, { limit = 20, offset = 0 } = {}) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  assertVisible(viewerId, m);
  const n = Math.min(Number(limit) || 20, 50);
  const off = Math.max(Number(offset) || 0, 0);
  const total = db.prepare('SELECT COUNT(*) AS n FROM moment_likes WHERE moment_id=?').get(momentId).n;
  const rows = db.prepare(
    'SELECT ml.user_id, ml.created_at, u.username, u.avatar FROM moment_likes ml JOIN users u ON u.id=ml.user_id WHERE ml.moment_id=? ORDER BY ml.created_at LIMIT ? OFFSET ?'
  ).all(momentId, n, off);
  return paginated(rows, { total, limit: n, offset: off });
}

function listComments(viewerId, momentId, { limit = 20, offset = 0 } = {}) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  assertVisible(viewerId, m);
  const n = Math.min(Number(limit) || 20, 50);
  const off = Math.max(Number(offset) || 0, 0);
  const total = db.prepare('SELECT COUNT(*) AS n FROM moment_comments WHERE moment_id=?').get(momentId).n;
  const rows = db.prepare(
    'SELECT mc.id, mc.user_id, mc.content, mc.reply_to_user, mc.created_at, u.username, u.avatar FROM moment_comments mc JOIN users u ON u.id=mc.user_id WHERE mc.moment_id=? ORDER BY mc.created_at LIMIT ? OFFSET ?'
  ).all(momentId, n, off);
  return paginated(rows, { total, limit: n, offset: off });
}

// ── 删评论（评论作者或动态作者）────────────────────────────────
function deleteComment(userId, commentId) {
  const c = db.prepare('SELECT * FROM moment_comments WHERE id=?').get(commentId);
  if (!c) throw notFound('评论不存在');
  const m = db.prepare('SELECT user_id FROM moments WHERE id=?').get(c.moment_id);
  if (c.user_id !== userId && m?.user_id !== userId) throw forbidden('无权删除该评论');
  db.prepare('DELETE FROM moment_comments WHERE id=?').run(commentId);
  // 默认保留对应通知（历史记录）；配置开启时才删
  if (config.moments.deleteNotifOnCancel) {
    db.prepare('DELETE FROM moment_notifications WHERE comment_id=?').run(commentId);
  }
  return { success: true };
}

// ── 举报动态（MO6）：落库供后台审核，不直接下架 ──────────────────
function reportMoment(userId, momentId, { reason } = {}) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  if (m.user_id === userId) throw badRequest('不能举报自己的动态');
  assertVisible(userId, m); // 看不到的动态不能举报
  const text = (typeof reason === 'string' ? reason : '').trim().slice(0, 200);
  try {
    db.prepare('INSERT INTO moment_reports (id,moment_id,reporter_id,reason) VALUES (?,?,?,?)')
      .run(uuidv4(), momentId, userId, text);
  } catch {
    // UNIQUE(moment_id, reporter_id)：同一人重复举报同一条
    throw conflict('已举报该动态', 'MOMENT_ALREADY_REPORTED');
  }
  return { success: true };
}

// ── 互动通知 feed（MO2）──────────────────────────────────────────
function listNotifications(userId, { limit = 20, offset = 0 } = {}) {
  const n = Math.min(Number(limit) || 20, 50);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = db.prepare(`
    SELECT mn.id, mn.type, mn.moment_id, mn.comment_id, mn.is_read, mn.created_at,
           u.id AS actor_id, u.username AS actor_name, u.avatar AS actor_avatar,
           m.content AS moment_content, m.images AS moment_images
    FROM moment_notifications mn
    JOIN users u ON u.id = mn.actor_id
    LEFT JOIN moments m ON m.id = mn.moment_id
    WHERE mn.user_id = ?
    ORDER BY mn.created_at DESC, mn.rowid DESC
    LIMIT ? OFFSET ?
  `).all(userId, n, off);
  return rows.map(r => {
    const images = JSON.parse(r.moment_images || '[]');
    const commentContent = r.comment_id
      ? (db.prepare('SELECT content FROM moment_comments WHERE id=?').get(r.comment_id)?.content || '')
      : '';
    return {
      id: r.id,
      type: r.type,
      momentId: r.moment_id,
      commentId: r.comment_id,
      read: !!r.is_read,
      createdAt: r.created_at,
      actor: { id: r.actor_id, username: r.actor_name, avatar: r.actor_avatar },
      moment: { content: r.moment_content || '', thumb: images[0] || '' },
      commentContent,
    };
  });
}

function unreadNotificationCount(userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM moment_notifications WHERE user_id=? AND is_read=0').get(userId).n;
}

function markNotificationsRead(userId) {
  db.prepare('UPDATE moment_notifications SET is_read=1 WHERE user_id=? AND is_read=0').run(userId);
  return { success: true };
}

module.exports = {
  createMoment, timeline, userMoments, getMoment, deleteMoment,
  toggleLike, addComment, deleteComment, listLikes, listComments,
  reportMoment,
  listNotifications, unreadNotificationCount, markNotificationsRead,
};
