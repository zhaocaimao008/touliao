'use strict';
/**
 * 文件注册表 —— /uploads 静态文件访问控制的唯一授权依据。
 *
 * 背景（P1-02 planted-row 绕过）：
 *   旧实现用 messages/moments 表反查「是否存在引用该 URL 的行」来判断授权。
 *   但攻击者可以在自己会话/朋友圈植入引用受害者文件 URL 的行（messages 行、
 *   moment images 数组），从而把受害者文件「认领」为自己的资源 → IDOR 未根除。
 *
 * 方案：上传发生时在 file_registry 登记文件的真实归属（owner + conversation），
 *   访问时只信注册表。引用行可以被伪造，注册表只能由服务端上传流程写入。
 *
 * 注意：connection.js 启动时也会 require 本模块（回填），为避免循环依赖
 * （本模块 require connection 而 connection 尚未导出 db），db 采用延迟获取。
 */

// 延迟获取 db：首次调用时再 require（connection.js 完成导出后即可安全引用）
function getDb() {
  return require('../db/connection').db;
}

/**
 * 登记一个上传文件。
 * @param {object} r
 * @param {string} r.path       文件访问路径，如 /uploads/files/<uuid>.png
 * @param {string} r.ownerId    上传者（文件真实所有者）
 * @param {string} [r.conversationId] 归属会话（聊天附件/背景图；moments 图片为空）
 * @param {string} r.kind       'files' | 'moments' | 'bg' | 'avatars'
 */
function registerFile({ path, ownerId, conversationId = '', kind }) {
  if (!path || !ownerId || !kind) return;
  getDb().prepare(
    `INSERT OR REPLACE INTO file_registry (path, owner_id, conversation_id, kind, created_at)
     VALUES (?,?,?,?, strftime('%s','now'))`
  ).run(path, ownerId, conversationId, kind);
}

/** 查询注册表（未登记返回 undefined）。 */
function lookupFile(path) {
  return getDb().prepare('SELECT * FROM file_registry WHERE path=?').get(path);
}

// These exact local categories are already visible to every authenticated user
// in app.js. Do not extend this exception to moments, CDN URLs or path aliases.
const isPublicReference = path => typeof path === 'string'
  && /^\/uploads\/(?:stickers|avatars)\/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(path);

// A readable message (or a historical share) does not establish ownership of its file.
// Check the upload's registered owner or current ORIGINAL conversation membership.
const referenceAccessSql = `SELECT 1 FROM file_registry r WHERE r.path=? AND
  (r.owner_id=? OR EXISTS (SELECT 1 FROM conversation_members cm
    WHERE cm.conversation_id=r.conversation_id AND cm.user_id=?))`;
function canReferenceFile(path, userId) {
  return isPublicReference(path) || !!getDb().prepare(referenceAccessSql).get(path, userId, userId);
}

/** Include this op in the SAME worker transaction as the message and sync event.
 * Recheck current authority at commit time, including the destination membership.
 * The NOT NULL constraint fails closed; only duplicate grants are ignored.
 */
function fileShareOp(path, conversationId, userId) {
  return {
    sql: `INSERT INTO file_registry_shares (path, conversation_id) VALUES (?,
      CASE WHEN (?=1 OR EXISTS (${referenceAccessSql})) AND EXISTS
        (SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?)
      THEN ? ELSE NULL END)
      ON CONFLICT(path, conversation_id) DO NOTHING`,
    params: [path, Number(isPublicReference(path)), path, userId, userId, conversationId, userId, conversationId],
  };
}

/**
 * 存量数据回填：把修复前已上传、仍被引用的文件登记进注册表（幂等，启动时调用一次）。
 * 已删除消息（file_url 已清空）不登记 → 物理文件虽在磁盘但不再可被静态访问。
 */
function backfillRegistry() {
  const db = getDb();
  // 聊天附件：messages 表中仍在用的 file_url
  db.prepare(
    `INSERT OR IGNORE INTO file_registry (path, owner_id, conversation_id, kind, created_at)
     SELECT file_url, sender_id, conversation_id, 'files', strftime('%s','now')
     FROM messages WHERE file_url LIKE '/uploads/files/%' AND deleted=0`
  ).run();

  // 朋友圈图片：moments.images JSON 数组中的 /uploads/moments/ URL（owner = moment 作者）
  const moments = db.prepare("SELECT user_id, images FROM moments WHERE images LIKE '%/uploads/moments/%'").all();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO file_registry (path, owner_id, conversation_id, kind, created_at)
     VALUES (?,?,'','moments', strftime('%s','now'))`
  );
  for (const m of moments) {
    try {
      const arr = JSON.parse(m.images);
      for (const u of arr) {
        if (typeof u === 'string' && u.startsWith('/uploads/moments/')) ins.run(u, m.user_id);
      }
    } catch { /* 忽略脏 JSON */ }
  }

  // 会话背景图
  db.prepare(
    `INSERT OR IGNORE INTO file_registry (path, owner_id, conversation_id, kind, created_at)
     SELECT background, user_id, conversation_id, 'bg', strftime('%s','now')
     FROM conversation_settings WHERE background LIKE '/uploads/bg/%'`
  ).run();

  // 头像（登录可见，登记便于一致管理）
  db.prepare(
    `INSERT OR IGNORE INTO file_registry (path, owner_id, conversation_id, kind, created_at)
     SELECT avatar, id, '', 'avatars', strftime('%s','now')
     FROM users WHERE avatar LIKE '/uploads/avatars/%'`
  ).run();
}

module.exports = { registerFile, lookupFile, backfillRegistry, canReferenceFile, fileShareOp };
