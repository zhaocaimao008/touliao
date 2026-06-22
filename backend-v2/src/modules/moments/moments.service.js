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
const { badRequest, forbidden, notFound } = require('../../utils/http');

function isFriend(viewerId, authorId) {
  return !!db.prepare('SELECT 1 FROM contacts WHERE user_id=? AND contact_id=?').get(viewerId, authorId);
}

// 可见性门控：本人可见全部；他人需好友且非 private
function assertVisible(viewerId, m) {
  if (m.user_id === viewerId) return;
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
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(viewerId, viewerId, viewerId, n, off);
  return rows.map(m => enrich(viewerId, m));
}

// ── 某用户的动态（好友或本人）──────────────────────────────────
function userMoments(viewerId, targetId) {
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
  } else {
    db.prepare('INSERT INTO moment_likes (moment_id,user_id) VALUES (?,?)').run(momentId, userId);
    liked = true;
    if (io && m.user_id !== userId) io.to(`user_${m.user_id}`).emit('moment_liked', { momentId, userId });
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

  const id = uuidv4();
  db.prepare('INSERT INTO moment_comments (id,moment_id,user_id,content,reply_to_user) VALUES (?,?,?,?,?)')
    .run(id, momentId, userId, text, replyToUser || '');
  if (io && m.user_id !== userId) io.to(`user_${m.user_id}`).emit('moment_commented', { momentId, userId });
  return db.prepare(
    'SELECT mc.id, mc.user_id, mc.content, mc.reply_to_user, mc.created_at, u.username, u.avatar FROM moment_comments mc JOIN users u ON u.id=mc.user_id WHERE mc.id=?'
  ).get(id);
}

// ── 删评论（评论作者或动态作者）────────────────────────────────
function deleteComment(userId, commentId) {
  const c = db.prepare('SELECT * FROM moment_comments WHERE id=?').get(commentId);
  if (!c) throw notFound('评论不存在');
  const m = db.prepare('SELECT user_id FROM moments WHERE id=?').get(c.moment_id);
  if (c.user_id !== userId && m?.user_id !== userId) throw forbidden('无权删除该评论');
  db.prepare('DELETE FROM moment_comments WHERE id=?').run(commentId);
  return { success: true };
}

module.exports = {
  createMoment, timeline, userMoments, getMoment, deleteMoment,
  toggleLike, addComment, deleteComment,
};
