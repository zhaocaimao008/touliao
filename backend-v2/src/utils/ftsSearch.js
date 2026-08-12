'use strict';
/**
 * SQLite FTS5 全文搜索工具
 * 用于消息、朋友圈等内容的高效全文检索
 */

const { db } = require('../db/connection');

/**
 * 初始化 FTS5 虚拟表
 * 需要在服务启动时调用一次
 */
function initFTS5() {
  try {
    // 检查虚拟表是否存在
    const exists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='messages_fts'
    `).get();

    if (exists) {
      console.log('[FTS5] messages_fts 虚拟表已存在');
      return;
    }

    // 创建 FTS5 虚拟表
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        id,
        content,
        type,
        conversation_id,
        sender_id,
        created_at,
        content='messages',
        content_rowid='rowid'
      );
    `);

    // 为历史消息重建索引
    const messages = db.prepare(`
      SELECT rowid, id, content, type, conversation_id, sender_id, created_at
      FROM messages
      WHERE deleted = 0 AND type IN ('text', 'image', 'file', 'video')
      ORDER BY rowid DESC
      LIMIT 100000
    `).all();

    console.log(`[FTS5] 为 ${messages.length} 条消息建立索引...`);

    const insert = db.prepare(`
      INSERT INTO messages_fts(rowid, id, content, type, conversation_id, sender_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const batch = db.transaction(() => {
      messages.forEach(msg => {
        try {
          insert.run(msg.rowid, msg.id, msg.content || '', msg.type, msg.conversation_id, msg.sender_id, msg.created_at);
        } catch (err) {
          console.warn(`[FTS5] 索引失败 message_id=${msg.id}:`, err.message);
        }
      });
    });

    batch();
    console.log('[FTS5] 虚拟表初始化完成');
  } catch (err) {
    console.error('[FTS5] 初始化失败:', err.message);
    throw err;
  }
}

/**
 * 搜索消息
 * @param {string} query - 搜索查询
 * @param {string} conversationId - 会话 ID（可选）
 * @param {string} userId - 用户 ID（可选，用于权限检查）
 * @param {object} options - 选项 { limit, offset, senderOnly }
 * @returns {Array} 搜索结果
 */
function searchMessages(query, conversationId, userId, options = {}) {
  const { limit = 50, offset = 0, senderOnly = null } = options;

  if (!query || query.trim().length === 0) {
    return [];
  }

  // 清理查询语句（防止 FTS5 语法错误）
  const cleanQuery = query
    .trim()
    .replace(/[^\w\s\-*"]/g, '') // 移除特殊字符，保留通配符和引号
    .substring(0, 100); // 限制长度

  if (cleanQuery.length === 0) {
    return [];
  }

  let sql = `
    SELECT 
      m.id,
      m.content,
      m.type,
      m.conversation_id,
      m.sender_id,
      m.created_at,
      u.username as senderName,
      u.avatar as senderAvatar,
      rank
    FROM messages_fts fts
    JOIN messages m ON m.id = fts.id
    JOIN users u ON u.id = m.sender_id
    WHERE fts.content MATCH ?
  `;

  const params = [cleanQuery];

  if (conversationId) {
    sql += ' AND m.conversation_id = ?';
    params.push(conversationId);
  }

  if (senderOnly) {
    sql += ' AND m.sender_id = ?';
    params.push(senderOnly);
  }

  sql += `
    ORDER BY rank DESC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  try {
    const results = db.prepare(sql).all(...params);
    return results;
  } catch (err) {
    console.warn('[FTS5] 搜索失败:', err.message, 'query:', cleanQuery);
    return [];
  }
}

/**
 * 添加消息到 FTS5 索引
 * 在消息创建时调用
 * @param {Object} message - 消息对象
 */
function indexMessage(message) {
  if (!message || !message.id) return;
  if (['text', 'image', 'file', 'video'].indexOf(message.type) === -1) return;

  try {
    const insert = db.prepare(`
      INSERT INTO messages_fts(id, content, type, conversation_id, sender_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      message.id,
      message.content || '',
      message.type,
      message.conversation_id,
      message.sender_id,
      message.created_at
    );
  } catch (err) {
    console.warn('[FTS5] 索引添加失败:', err.message);
  }
}

/**
 * 从 FTS5 索引删除消息
 * 在消息删除时调用
 * @param {string} messageId - 消息 ID
 */
function removeMessageFromIndex(messageId) {
  if (!messageId) return;

  try {
    const del = db.prepare('DELETE FROM messages_fts WHERE id = ?');
    del.run(messageId);
  } catch (err) {
    console.warn('[FTS5] 索引删除失败:', err.message);
  }
}

/**
 * 获取搜索统计
 * @param {string} conversationId - 会话 ID
 * @returns {Object} 统计信息
 */
function getSearchStats(conversationId) {
  try {
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT sender_id) as senders,
        COUNT(DISTINCT type) as types,
        MAX(created_at) as latestTime
      FROM messages_fts
      WHERE conversation_id = ?
    `).get(conversationId);

    return stats || { total: 0, senders: 0, types: 0, latestTime: 0 };
  } catch (err) {
    console.warn('[FTS5] 统计失败:', err.message);
    return { total: 0, senders: 0, types: 0, latestTime: 0 };
  }
}

module.exports = {
  initFTS5,
  searchMessages,
  indexMessage,
  removeMessageFromIndex,
  getSearchStats,
};
