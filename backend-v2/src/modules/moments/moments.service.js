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
const { isConfigured, getPublicBase } = require('../../utils/cloudStorage');

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

// 作者的"最近 N 天可见"设置（0=全部可见）
function authorVisibleDays(authorId) {
  return db.prepare('SELECT moments_visible_days AS d FROM user_settings WHERE user_id=?').get(authorId)?.d || 0;
}

// 可见性门控：本人可见全部；他人需好友、非 private、双方无拉黑，
// 并满足分组可见(include/exclude)与"最近 N 天可见"时间窗
function assertVisible(viewerId, m) {
  if (m.user_id === viewerId) return;
  if (isBlockedBetween(viewerId, m.user_id)) throw forbidden('无权查看该动态');
  if (m.visibility === 'private') throw forbidden('无权查看该动态');
  if (!isFriend(viewerId, m.user_id)) throw forbidden('无权查看该动态');

  // 分组可见：include=白名单内可见，exclude=黑名单外可见
  if (m.visibility === 'include' || m.visibility === 'exclude') {
    let list = [];
    try { list = JSON.parse(m.visible_to || '[]'); } catch { list = []; }
    const inList = list.map(String).includes(String(viewerId));
    if (m.visibility === 'include' && !inList) throw forbidden('无权查看该动态');
    if (m.visibility === 'exclude' && inList) throw forbidden('无权查看该动态');
  }

  // 最近 N 天可见
  const days = authorVisibleDays(m.user_id);
  if (days > 0 && m.created_at < Math.floor(Date.now() / 1000) - days * 86400) {
    throw forbidden('无权查看该动态');
  }
}

// 单条动态装配（作者、图片、点赞、评论、本人是否已赞）
// 列表(timeline/userMoments)传 caps 限制内联返回的点赞/评论条数，避免热门动态把上万条全拉下来；
// 计数走 COUNT(*)、liked 走直查——即便数组被截断也准确。详情(getMoment)不传 caps = 全量。
// hasMoreLikes/hasMoreComments 为加法字段，前端可据此用分页接口加载剩余（不传也优雅降级）。
function enrich(viewerId, m, { likeLimit = 0, commentLimit = 0 } = {}) {
  const author = db.prepare('SELECT id, username, avatar FROM users WHERE id=?').get(m.user_id);
  const likeCount = db.prepare('SELECT COUNT(*) AS n FROM moment_likes WHERE moment_id=?').get(m.id).n;
  const commentCount = db.prepare('SELECT COUNT(*) AS n FROM moment_comments WHERE moment_id=?').get(m.id).n;
  const liked = !!db.prepare('SELECT 1 FROM moment_likes WHERE moment_id=? AND user_id=?').get(m.id, viewerId);
  const likeCap = likeLimit > 0 ? ` LIMIT ${parseInt(likeLimit, 10)}` : '';
  const commentCap = commentLimit > 0 ? ` LIMIT ${parseInt(commentLimit, 10)}` : '';
  const likes = db.prepare(
    `SELECT ml.user_id, u.username FROM moment_likes ml JOIN users u ON u.id=ml.user_id WHERE ml.moment_id=? ORDER BY ml.created_at${likeCap}`
  ).all(m.id);
  const comments = db.prepare(
    `SELECT mc.id, mc.user_id, mc.content, mc.reply_to_user, mc.created_at, u.username, u.avatar FROM moment_comments mc JOIN users u ON u.id=mc.user_id WHERE mc.moment_id=? ORDER BY mc.created_at${commentCap}`
  ).all(m.id);
  const { visible_to, ...mPub } = m; // 不外泄分组可见名单
  return {
    ...mPub,
    images: JSON.parse(m.images || '[]'),
    author,
    likes,
    likeCount,
    liked,
    comments,
    commentCount,
    hasMoreLikes: likeCount > likes.length,
    hasMoreComments: commentCount > comments.length,
  };
}

// 批量装配（timeline/userMoments 用）：6 次查询覆盖全部动态，消除 N+1
function batchEnrich(viewerId, rows, { likeLimit = 0, commentLimit = 0 } = {}) {
  if (!rows.length) return [];
  const ids = rows.map(m => m.id);
  const ph = ids.map(() => '?').join(',');

  const authorIds = [...new Set(rows.map(m => m.user_id))];
  const authorPh = authorIds.map(() => '?').join(',');
  const authorMap = new Map();
  db.prepare(`SELECT id, username, avatar FROM users WHERE id IN (${authorPh})`).all(...authorIds)
    .forEach(u => authorMap.set(u.id, u));

  const likeCountMap = new Map(ids.map(id => [id, 0]));
  db.prepare(`SELECT moment_id, COUNT(*) AS n FROM moment_likes WHERE moment_id IN (${ph}) GROUP BY moment_id`).all(...ids)
    .forEach(r => likeCountMap.set(r.moment_id, r.n));

  const commentCountMap = new Map(ids.map(id => [id, 0]));
  db.prepare(`SELECT moment_id, COUNT(*) AS n FROM moment_comments WHERE moment_id IN (${ph}) GROUP BY moment_id`).all(...ids)
    .forEach(r => commentCountMap.set(r.moment_id, r.n));

  const likedSet = new Set();
  db.prepare(`SELECT moment_id FROM moment_likes WHERE moment_id IN (${ph}) AND user_id=?`).all(...ids, viewerId)
    .forEach(r => likedSet.add(r.moment_id));

  const likesMap = new Map(ids.map(id => [id, []]));
  const maxLikes = (likeLimit || 10) * ids.length;
  db.prepare(`SELECT ml.moment_id, ml.user_id, u.username FROM moment_likes ml JOIN users u ON u.id=ml.user_id WHERE ml.moment_id IN (${ph}) ORDER BY ml.moment_id, ml.created_at LIMIT ?`).all(...ids, maxLikes)
    .forEach(r => {
      const arr = likesMap.get(r.moment_id);
      if (!likeLimit || arr.length < likeLimit) arr.push({ user_id: r.user_id, username: r.username });
    });

  const commentsMap = new Map(ids.map(id => [id, []]));
  const maxComments = (commentLimit || 10) * ids.length;
  db.prepare(`SELECT mc.moment_id, mc.id, mc.user_id, mc.content, mc.reply_to_user, mc.created_at, u.username, u.avatar FROM moment_comments mc JOIN users u ON u.id=mc.user_id WHERE mc.moment_id IN (${ph}) ORDER BY mc.moment_id, mc.created_at LIMIT ?`).all(...ids, maxComments)
    .forEach(({ moment_id, ...rest }) => {
      const arr = commentsMap.get(moment_id);
      if (!commentLimit || arr.length < commentLimit) arr.push(rest);
    });

  return rows.map(m => {
    const likes = likesMap.get(m.id);
    const comments = commentsMap.get(m.id);
    const likeCount = likeCountMap.get(m.id);
    const commentCount = commentCountMap.get(m.id);
    const { visible_to, ...mPub } = m; // 不外泄分组可见名单
    return {
      ...mPub,
      images: JSON.parse(m.images || '[]'),
      author: authorMap.get(m.user_id),
      likes,
      likeCount,
      liked: likedSet.has(m.id),
      comments,
      commentCount,
      hasMoreLikes: likeCount > likes.length,
      hasMoreComments: commentCount > comments.length,
    };
  });
}

// ── 发布 ────────────────────────────────────────────────────────
function createMoment(io, userId, { content, images, visibility, visibleTo }) {
  const text = (content || '').trim();
  const rawImgs = Array.isArray(images) ? images.slice(0, 9) : [];
  // URL 白名单：只允许本服务器 uploads 目录或已配置的云存储域名
  const localPrefix = config.appUrl + '/uploads/';
  const cloudBase = isConfigured() ? getPublicBase() : null;
  const imgs = rawImgs.filter(url => {
    if (typeof url !== 'string') return false;
    if (url.startsWith(localPrefix) || url.startsWith('/uploads/')) return true;
    if (cloudBase && url.startsWith(cloudBase + '/')) return true;
    return false;
  });
  if (!text && imgs.length === 0) throw badRequest('内容不能为空');
  if (text.length > 5000) throw badRequest('内容过长');
  const vis = ['all', 'friends', 'private', 'include', 'exclude'].includes(visibility) ? visibility : 'all';

  // 分组可见：visible_to 仅保留确为好友的 id（防越权 / 脏数据）
  let visList = null;
  if (vis === 'include' || vis === 'exclude') {
    const arr = Array.isArray(visibleTo) ? [...new Set(visibleTo.map(String))].slice(0, 500) : [];
    if (arr.length) {
      const ph = arr.map(() => '?').join(',');
      const friends = db.prepare(`SELECT contact_id FROM contacts WHERE user_id=? AND contact_id IN (${ph})`)
        .all(userId, ...arr).map(r => r.contact_id);
      visList = JSON.stringify(friends);
    } else {
      visList = '[]';
    }
    if (vis === 'include' && JSON.parse(visList).length === 0) throw badRequest('请至少选择一位可见的好友');
  }

  const id = uuidv4();
  db.prepare('INSERT INTO moments (id,user_id,content,images,visibility,visible_to) VALUES (?,?,?,?,?,?)')
    .run(id, userId, text, JSON.stringify(imgs), vis, visList);

  // 新动态推送：按可见性收敛推送名单，排除双向拉黑用户
  if (io && vis !== 'private') {
    let targets = db.prepare('SELECT contact_id FROM contacts WHERE user_id=?').all(userId).map(f => f.contact_id);
    if (vis === 'include') { const set = new Set(JSON.parse(visList)); targets = targets.filter(t => set.has(t)); }
    else if (vis === 'exclude') { const set = new Set(JSON.parse(visList)); targets = targets.filter(t => !set.has(t)); }
    const blocked = new Set(
      db.prepare('SELECT blocked_id u FROM blocked_users WHERE user_id=? UNION SELECT user_id u FROM blocked_users WHERE blocked_id=?')
        .all(userId, userId).map(r => r.u)
    );
    targets = targets.filter(t => !blocked.has(t));
    if (targets.length) io.to(targets.map(t => `user_${t}`)).emit('new_moment', { momentId: id, userId });
  }
  return enrich(userId, db.prepare('SELECT * FROM moments WHERE id=?').get(id));
}

// ── 时间线（本人 + 好友）────────────────────────────────────────
function timeline(viewerId, { limit = 20, offset = 0 } = {}) {
  const n = Math.min(Number(limit) || 20, 50);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = db.prepare(`
    SELECT m.* FROM moments m
    LEFT JOIN user_settings us ON us.user_id = m.user_id
    WHERE (m.user_id=? OR m.user_id IN (SELECT contact_id FROM contacts WHERE user_id=?))
      AND (
        m.user_id=?  -- 本人动态全部可见，不受可见性/时间窗约束
        OR (
          m.visibility != 'private'
          -- 分组可见：include 白名单内、exclude 黑名单外
          AND (
            m.visibility IN ('all','friends')
            OR (m.visibility='include' AND EXISTS (SELECT 1 FROM json_each(COALESCE(m.visible_to,'[]')) WHERE value=?))
            OR (m.visibility='exclude' AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(m.visible_to,'[]')) WHERE value=?))
          )
          -- 最近 N 天可见（作者设置；0=全部）
          AND (COALESCE(us.moments_visible_days,0)=0
               OR m.created_at >= (CAST(strftime('%s','now') AS INTEGER) - us.moments_visible_days*86400))
        )
      )
      -- MO6：排除我拉黑的人 / 拉黑我的人的动态（本人动态不受影响）
      AND (m.user_id=? OR m.user_id NOT IN (
        SELECT blocked_id FROM blocked_users WHERE user_id=?
        UNION SELECT user_id FROM blocked_users WHERE blocked_id=?
      ))
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `).all(viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, viewerId, n, off);
  return batchEnrich(viewerId, rows, { likeLimit: 50, commentLimit: 10 });
}

// ── 某用户的动态（好友或本人）──────────────────────────────────
function userMoments(viewerId, targetId, { limit = 20, offset = 0 } = {}) {
  if (targetId !== viewerId && isBlockedBetween(viewerId, targetId)) throw forbidden('无权查看该动态');
  if (targetId !== viewerId && !isFriend(viewerId, targetId)) throw forbidden('仅好友可见');

  const n = Math.min(parseInt(limit) || 20, 50);
  const off = Math.max(parseInt(offset) || 0, 0);
  let rows;
  if (targetId === viewerId) {
    rows = db.prepare('SELECT * FROM moments WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?').all(targetId, n, off);
  } else {
    rows = db.prepare(`
      SELECT m.* FROM moments m
      LEFT JOIN user_settings us ON us.user_id = m.user_id
      WHERE m.user_id=?
        AND m.visibility != 'private'
        AND (
          m.visibility IN ('all','friends')
          OR (m.visibility='include' AND EXISTS (SELECT 1 FROM json_each(COALESCE(m.visible_to,'[]')) WHERE value=?))
          OR (m.visibility='exclude' AND NOT EXISTS (SELECT 1 FROM json_each(COALESCE(m.visible_to,'[]')) WHERE value=?))
        )
        AND (COALESCE(us.moments_visible_days,0)=0
             OR m.created_at >= (CAST(strftime('%s','now') AS INTEGER) - us.moments_visible_days*86400))
      ORDER BY m.created_at DESC LIMIT ? OFFSET ?
    `).all(targetId, viewerId, viewerId, n, off);
  }
  return batchEnrich(viewerId, rows, { likeLimit: 50, commentLimit: 10 });
}

// ── 单条动态详情（本人或可见好友）──────────────────────────────
function getMoment(viewerId, momentId) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  assertVisible(viewerId, m);
  return enrich(viewerId, m);
}

// 物理删除一条动态及其级联数据（评论/点赞/通知/举报）。不做权限校验，调用方负责鉴权。
// 作者删除(deleteMoment) 与 后台举报处理(admin.resolveReport) 共用，避免重复。
function purgeMoment(momentId) {
  const m = db.prepare('SELECT images FROM moments WHERE id=?').get(momentId);
  const images = JSON.parse(m?.images || '[]');

  db.transaction(() => {
    db.prepare('DELETE FROM moment_comments WHERE moment_id=?').run(momentId);
    db.prepare('DELETE FROM moment_likes WHERE moment_id=?').run(momentId);
    db.prepare('DELETE FROM moment_notifications WHERE moment_id=?').run(momentId);
    db.prepare('DELETE FROM moment_reports WHERE moment_id=?').run(momentId);
    db.prepare('DELETE FROM moments WHERE id=?').run(momentId);
  })();

  // 异步清理本地存储图片（OSS 图片为外部 URL，跳过）
  const fs = require('fs');
  const path = require('path');
  for (const url of images) {
    try {
      const rel = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/uploads\//, '');
      const abs = path.join(config.uploadsRoot, rel);
      const safeRoot = config.uploadsRoot.endsWith(path.sep) ? config.uploadsRoot : config.uploadsRoot + path.sep;
      if (abs.startsWith(safeRoot) && rel && !rel.includes('..')) {
        fs.unlink(abs, () => {});
      }
    } catch {}
  }
}

// ── 删除动态（仅作者，级联清理点赞/评论）──────────────────────
function deleteMoment(userId, momentId) {
  const m = db.prepare('SELECT * FROM moments WHERE id=?').get(momentId);
  if (!m) throw notFound('动态不存在');
  if (m.user_id !== userId) throw forbidden('只能删除自己的动态');
  purgeMoment(momentId);
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
    try {
      db.prepare('INSERT INTO moment_likes (moment_id,user_id) VALUES (?,?)').run(momentId, userId);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') { liked = false; }
      else throw e;
      const likeCount = db.prepare('SELECT COUNT(*) AS n FROM moment_likes WHERE moment_id=?').get(momentId).n;
      return { liked, likeCount };
    }
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

  // MO4：reply_to_user 必须是真实存在且参与过该动态（作者或评论者）的用户
  let replyTo = '';
  if (replyToUser) {
    if (typeof replyToUser !== 'string') throw badRequest('回复对象不存在');
    const isAuthor = replyToUser === m.user_id;
    const isCommenter = !!db.prepare('SELECT 1 FROM moment_comments WHERE moment_id=? AND user_id=?').get(momentId, replyToUser);
    if (!isAuthor && !isCommenter) throw badRequest('回复对象不存在');
    replyTo = replyToUser;
  }

  const id = uuidv4();
  db.prepare('INSERT INTO moment_comments (id,moment_id,user_id,content,reply_to_user) VALUES (?,?,?,?,?)')
    .run(id, momentId, userId, text, replyTo);
  if (io && m.user_id !== userId) io.to(`user_${m.user_id}`).emit('moment_commented', { momentId, userId });
  addInteractNotification({ recipientId: m.user_id, actorId: userId, momentId, type: 'comment', commentId: id });
  // 被回复人≠动态作者 且 被回复人≠评论者 时，另行通知
  if (replyTo && replyTo !== m.user_id && replyTo !== userId) {
    if (io) io.to(`user_${replyTo}`).emit('moment_commented', { momentId, userId });
    addInteractNotification({ recipientId: replyTo, actorId: userId, momentId, type: 'comment', commentId: id });
  }
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
           m.content AS moment_content, m.images AS moment_images,
           mc.content AS comment_content
    FROM moment_notifications mn
    JOIN users u ON u.id = mn.actor_id
    LEFT JOIN moments m ON m.id = mn.moment_id
    LEFT JOIN moment_comments mc ON mc.id = mn.comment_id
    WHERE mn.user_id = ?
    ORDER BY mn.created_at DESC, mn.rowid DESC
    LIMIT ? OFFSET ?
  `).all(userId, n, off);
  return rows.map(r => {
    const images = JSON.parse(r.moment_images || '[]');
    return {
      id: r.id,
      type: r.type,
      momentId: r.moment_id,
      commentId: r.comment_id,
      read: !!r.is_read,
      createdAt: r.created_at,
      actor: { id: r.actor_id, username: r.actor_name, avatar: r.actor_avatar },
      moment: { content: r.moment_content || '', thumb: images[0] || '' },
      commentContent: r.comment_content || '',
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
  createMoment, timeline, userMoments, getMoment, deleteMoment, purgeMoment,
  toggleLike, addComment, deleteComment, listLikes, listComments,
  reportMoment,
  listNotifications, unreadNotificationCount, markNotificationsRead,
};
