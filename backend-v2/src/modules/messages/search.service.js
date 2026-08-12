'use strict';
/**
 * 消息搜索业务逻辑
 * 集成 FTS5 + Redis 缓存
 */

const { db } = require('../../db/connection');
const { ftsSearch } = require('../../integrations/redisCache');
const { searchMessages, getSearchStats } = require('../../utils/ftsSearch');
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
  const cacheKey = `search:${conversationId}:${query}:${senderOnly || 'all'}:${limit}:${offset}`;

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

  // FTS5 搜索
  const results = searchMessages(query, conversationId, userId, {
    limit,
    offset,
    senderOnly,
  });

  // 获取总数（无 offset/limit）
  const allResults = searchMessages(query, conversationId, userId, {
    limit: 999999,
    offset: 0,
    senderOnly,
  });

  const result = {
    results,
    total: allResults.length,
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

  // 获取用户所有会话
  const convRows = db.prepare(`
    SELECT DISTINCT conversation_id FROM conversation_members WHERE user_id = ?
  `).all(userId);

  const conversationIds = convRows.map(r => r.conversation_id);

  if (conversationIds.length === 0) {
    return { results: [], total: 0, conversations: {}, took: 0 };
  }

  // 在所有会话中搜索
  const results = [];
  const conversationMap = {};

  for (const convId of conversationIds) {
    const convResults = searchMessages(query, convId, userId, {
      limit: 999999,
      offset: 0,
    });

    convResults.forEach(msg => {
      results.push(msg);
      if (!conversationMap[convId]) {
        const conv = db.prepare('SELECT id, name, type FROM conversations WHERE id = ?').get(convId);
        conversationMap[convId] = conv;
      }
    });
  }

  // 排序并分页
  results.sort((a, b) => b.created_at - a.created_at);
  const paged = results.slice(offset, offset + limit);

  const result = {
    results: paged,
    total: results.length,
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
