'use strict';
/**
 * SQLite FTS5 全文搜索工具
 * 用于消息、朋友圈等内容的高效全文检索
 */

const { db } = require('../db/connection');

/**
 * 初始化 FTS5 虚拟表（如表已存在则跳过）。
 * 实际表由 schema.js 中的迁移语句创建，schema 为：
 *   CREATE VIRTUAL TABLE messages_fts USING fts5(
 *     message_id    UNINDEXED,
 *     conversation_id UNINDEXED,
 *     content,
 *     tokenize = 'trigram'
 *   )
 * 索引维护由三个数据库触发器（fts_messages_insert/delete/edit）自动完成，
 * 无需应用层手动调用 indexMessage / removeMessageFromIndex。
 */
function initFTS5() {
  try {
    // 检查虚拟表是否存在
    const exists = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='messages_fts'
    `).get();

    if (exists) {
      console.debug('[FTS5] messages_fts 虚拟表已存在，跳过初始化');
      return;
    }

    // 表不存在时按正确 schema 创建（通常由 schema.js 负责，此处作为兜底）
    db.exec(`
      CREATE VIRTUAL TABLE messages_fts USING fts5(
        message_id    UNINDEXED,
        conversation_id UNINDEXED,
        content,
        tokenize = 'trigram'
      );
    `);

    // 为历史文字消息重建索引（触发器仅覆盖新消息）
    const messages = db.prepare(`
      SELECT id, conversation_id, content
      FROM messages
      WHERE deleted = 0 AND type = 'text'
      ORDER BY rowid DESC
      LIMIT 100000
    `).all();

    console.log(`[FTS5] 为 ${messages.length} 条历史文字消息建立索引...`);

    const insert = db.prepare(
      `INSERT INTO messages_fts(message_id, conversation_id, content) VALUES (?, ?, ?)`
    );

    db.transaction(() => {
      messages.forEach(msg => {
        try {
          insert.run(msg.id, msg.conversation_id, msg.content || '');
        } catch (err) {
          console.warn(`[FTS5] 索引失败 message_id=${msg.id}:`, err.message);
        }
      });
    })();

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

  // 截断到 100 个字符，trim，但不用 ASCII-only 正则（否则会把中文全部删除）
  const trimmed = query.trim().substring(0, 100);

  if (trimmed.length === 0) {
    return [];
  }

  // trigram 分词器对任意 Unicode（含中文）均有效；
  // 将整个查询串包在双引号中作短语搜索，避免 FTS5 运算符注入。
  // 双引号内部的 `"` 需转义为 `""（FTS5 规范）。
  const ftsPhrase = `"${trimmed.replace(/"/g, '""')}"`;

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
    JOIN messages m ON m.id = fts.message_id
    JOIN users u ON u.id = m.sender_id
    WHERE fts.content MATCH ?
  `;

  const params = [ftsPhrase];

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
    console.warn('[FTS5] 搜索失败:', err.message, 'query:', trimmed);
    return [];
  }
}

/**
 * 添加消息到 FTS5 索引
 * 注意：FTS5 索引通过数据库触发器（fts_messages_insert/fts_messages_edit）自动维护，
 * 此函数保留供手动补录（如迁移场景），日常消息发送无需调用。
 * @param {Object} message - 消息对象
 */
function indexMessage(message) {
  if (!message || !message.id) return;
  if (['text', 'image', 'file', 'video'].indexOf(message.type) === -1) return;

  try {
    db.prepare(`
      INSERT INTO messages_fts(message_id, conversation_id, content)
      VALUES (?, ?, ?)
    `).run(message.id, message.conversation_id, message.content || '');
  } catch (err) {
    console.warn('[FTS5] 索引添加失败:', err.message);
  }
}

/**
 * 从 FTS5 索引删除消息
 * 注意：FTS5 索引通过数据库触发器（fts_messages_delete）自动维护，
 * 此函数保留供手动清理（如迁移场景），日常消息撤回无需调用。
 * @param {string} messageId - 消息 ID
 */
function removeMessageFromIndex(messageId) {
  if (!messageId) return;

  try {
    db.prepare('DELETE FROM messages_fts WHERE message_id = ?').run(messageId);
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
    // messages_fts 虚拟表只有 (message_id, conversation_id, content)，
    // sender_id / type / created_at 需 JOIN messages 表才能获取。
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT m.sender_id) as senders,
        COUNT(DISTINCT m.type) as types,
        MAX(m.created_at) as latestTime
      FROM messages_fts fts
      JOIN messages m ON m.id = fts.message_id
      WHERE fts.conversation_id = ?
    `).get(conversationId);

    return stats || { total: 0, senders: 0, types: 0, latestTime: 0 };
  } catch (err) {
    console.warn('[FTS5] 统计失败:', err.message);
    return { total: 0, senders: 0, types: 0, latestTime: 0 };
  }
}

/**
 * 统计单个会话内匹配消息的数量（不加载消息体，仅返回 COUNT）。
 * 用于替代 "limit=999999 再取 .length" 的旧计数方式，避免把所有行加载进内存。
 * @param {string} query           - 搜索查询
 * @param {string} conversationId  - 会话 ID
 * @param {string|null} senderOnly - 仅统计该发送者的消息（可选）
 * @returns {number} 匹配行数
 */
function countMessages(query, conversationId, senderOnly = null) {
  const trimmed = (query || '').trim().substring(0, 100);
  if (!trimmed) return 0;

  const ftsPhrase = `"${trimmed.replace(/"/g, '""')}"`;
  let sql = `
    SELECT COUNT(*) AS n
    FROM messages_fts fts
    JOIN messages m ON m.id = fts.message_id
    WHERE fts.content MATCH ?
    AND m.conversation_id = ?
  `;
  const params = [ftsPhrase, conversationId];
  if (senderOnly) {
    sql += ' AND m.sender_id = ?';
    params.push(senderOnly);
  }
  try {
    return db.prepare(sql).get(...params)?.n ?? 0;
  } catch (err) {
    console.warn('[FTS5] countMessages 失败:', err.message);
    return 0;
  }
}

/**
 * 跨多个会话的一次性 FTS5 搜索（用于全局搜索，替代 N+1 循环）。
 * 用 IN (?, ?, ...) 过滤，只发起 2 条 SQL（COUNT + SELECT），不论会话数量多少。
 * @param {string}   query           - 搜索查询
 * @param {string[]} conversationIds - 用户所属会话 ID 列表
 * @param {object}   options         - { limit, offset }
 * @returns {{ results: Array, total: number }}
 */
function searchMessagesInConversations(query, conversationIds, { limit = 100, offset = 0 } = {}) {
  if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
    return { results: [], total: 0 };
  }

  const trimmed = (query || '').trim().substring(0, 100);
  if (!trimmed) return { results: [], total: 0 };

  const ftsPhrase = `"${trimmed.replace(/"/g, '""')}"`;
  // 为 IN 子句生成等数量的占位符
  const ph = conversationIds.map(() => '?').join(',');

  const baseWhere = `
    FROM messages_fts fts
    JOIN messages m ON m.id = fts.message_id
    JOIN users u ON u.id = m.sender_id
    WHERE fts.content MATCH ?
    AND m.conversation_id IN (${ph})
  `;
  const baseParams = [ftsPhrase, ...conversationIds];

  try {
    const total = db.prepare(`SELECT COUNT(*) AS n ${baseWhere}`)
      .get(...baseParams)?.n ?? 0;

    const results = db.prepare(`
      SELECT
        m.id,
        m.content,
        m.type,
        m.conversation_id,
        m.sender_id,
        m.created_at,
        u.username AS senderName,
        u.avatar   AS senderAvatar
      ${baseWhere}
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...baseParams, limit, offset);

    return { results, total };
  } catch (err) {
    console.warn('[FTS5] searchMessagesInConversations 失败:', err.message, 'query:', trimmed);
    return { results: [], total: 0 };
  }
}

module.exports = {
  initFTS5,
  searchMessages,
  countMessages,
  searchMessagesInConversations,
  indexMessage,
  removeMessageFromIndex,
  getSearchStats,
};
