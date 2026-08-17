'use strict';
/**
 * 消息搜索业务逻辑
 * 集成 FTS5 + Redis 缓存
 *
 * 性能设计要点：
 *   - searchInConversation：分页结果 + COUNT(*) 各一条 SQL（共 2 次 FTS5 查询），
 *     不再用 limit=999999 把全部结果加载进内存来计数。
 *   - searchGlobal：一次性把用户所有会话 ID 传给 searchMessagesInConversations，
 *     只发起 2 条 SQL（COUNT + SELECT），消除 N+1 循环。
 *     会话信息用一条 IN(?) 批量拉取，不在循环里逐个查库。
 */

const { db } = require('../../db/connection');
const { searchMessages, countMessages, searchMessagesInConversations, getSearchStats } = require('../../utils/ftsSearch');
const { requireMember } = require('./shared');
const cache = require('../../utils/cache');

/**
 * 在会话中搜索消息
 * @param {string} conversationId - 会话 ID
 * @param {string} userId - 用户 ID
 * @param {string} query - 搜索查询
 * @param {object} options - { limit, offset, senderOnly }
 * @returns {object} { results, total, took }
 */
async function searchInConversation(conversationId, userId, query, options = {}) {
  requireMember(conversationId, userId);

  if (!query || query.trim().length === 0) {
    return { results: [], total: 0, took: 0 };
  }

  const startTime = Date.now();
  const { limit = 50, offset = 0, senderOnly = null } = options;

  // 生成缓存 key
  const cacheKey = `search:${conversationId}:${userId}:${query}:${senderOnly || 'all'}:${limit}:${offset}`;

  // 先查缓存（10 分钟有效期）
  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      const result = JSON.parse(cached);
      result.fromCache = true;
      result.took = Date.now() - startTime;
      return result;
    }
  } catch (err) {
    console.warn('[Search] 缓存查询失败:', err.message);
  }

  // 分页结果 + COUNT — 各一条 SQL，不再用 limit=999999 全量加载
  const results = searchMessages(query, conversationId, userId, { limit, offset, senderOnly });
  const total   = countMessages(query, conversationId, senderOnly, userId);

  const result = {
    results,
    total,
    limit,
    offset,
    took: Date.now() - startTime,
    fromCache: false,
  };

  // 写入缓存
  try {
    await cache.set(cacheKey, JSON.stringify(result), 600); // 10 分钟
  } catch (err) {
    console.warn('[Search] 缓存写入失败:', err.message);
  }

  return result;
}

/**
 * 全局搜索（所有会话）
 * @param {string} userId - 用户 ID
 * @param {string} query - 搜索查询
 * @param {object} options - { limit, offset }
 * @returns {object} { results, total, conversations, took }
 */
async function searchGlobal(userId, query, options = {}) {
  if (!query || query.trim().length === 0) {
    return { results: [], total: 0, conversations: {}, took: 0 };
  }

  const startTime = Date.now();
  const { limit = 100, offset = 0 } = options;

  // 缓存 key
  const cacheKey = `search:global:${userId}:${query}:${limit}:${offset}`;

  try {
    const cached = await cache.get(cacheKey);
    if (cached) {
      const result = JSON.parse(cached);
      result.fromCache = true;
      result.took = Date.now() - startTime;
      return result;
    }
  } catch (err) {
    console.warn('[Search] 缓存查询失败:', err.message);
  }

  // 获取用户所有会话 ID
  const convRows = db.prepare(
    'SELECT DISTINCT conversation_id FROM conversation_members WHERE user_id = ?'
  ).all(userId);
  const conversationIds = convRows.map(r => r.conversation_id);

  if (conversationIds.length === 0) {
    return { results: [], total: 0, conversations: {}, took: 0 };
  }

  // 一次性 FTS5 搜索（COUNT + SELECT，共 2 条 SQL，不再 N+1 循环）
  const { results, total } = searchMessagesInConversations(query, conversationIds, userId, { limit, offset });

  // 批量拉取本次结果涉及的会话信息（一条 IN 查询，不在循环里逐个查）
  const hitConvIds = [...new Set(results.map(m => m.conversation_id))];
  let conversationMap = {};
  if (hitConvIds.length > 0) {
    const ph2 = hitConvIds.map(() => '?').join(',');
    db.prepare(`SELECT id, name, type FROM conversations WHERE id IN (${ph2})`)
      .all(...hitConvIds)
      .forEach(c => { conversationMap[c.id] = c; });
  }

  const result = {
    results,
    total,
    conversations: conversationMap,
    limit,
    offset,
    took: Date.now() - startTime,
    fromCache: false,
  };

  // 写入缓存
  try {
    await cache.set(cacheKey, JSON.stringify(result), 300); // 5 分钟
  } catch (err) {
    console.warn('[Search] 缓存写入失败:', err.message);
  }

  return result;
}

/**
 * 获取某个用户的搜索热词
 * @param {string} conversationId - 会话 ID
 * @returns {object} 搜索统计
 */
function getConversationSearchStats(conversationId) {
  return getSearchStats(conversationId);
}

/**
 * 清除搜索缓存（消息变更时调用）
 * @param {string} conversationId - 会话 ID
 */
async function clearSearchCache(conversationId) {
  try {
    const pattern = `search:${conversationId}:*`;
    await cache.delPattern(pattern);
  } catch (err) {
    console.warn('[Search] 缓存清除失败:', err.message);
  }
}

module.exports = {
  searchInConversation,
  searchGlobal,
  getConversationSearchStats,
  clearSearchCache,
};
