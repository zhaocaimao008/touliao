'use strict';
/**
 * 搜索结果排序与排名 (P4.3 优化)
 * 按相关性、时间、热度多维度排序
 */

const { redis } = require('./redis');
const DAY = 86400000; // 1 天毫秒数（只用于 calcRecencyScore 的时间差计算）
// 2026-10-11：Redis EXPIRE 的单位是秒。之前直接传 7 * DAY / 30 * DAY（毫秒数），
// TTL 实际变成约 19 年 / 82 年，用户搜索历史 key 等于永不过期（生产 Redis 无 maxmemory、noeviction）。
const DAY_S = 86400; // 1 天秒数（只用于 Redis EXPIRE）
const SCAN_COUNT = 200; // SCAN 每批建议遍历的 key 数

/**
 * 2026-10-11：用 SCAN 游标分批遍历代替 KEYS。KEYS 是 O(全库 key 数) 的单条阻塞命令，
 * 且 db5 与其他缓存共用，每次取搜索建议都会把整库扫一遍。SCAN 可能返回重复 key，这里去重。
 * 测试环境的内存 mock / 无 Redis 时的 no-op 降级对象没有 scan，退回原来的 keys，行为不变。
 */
async function scanKeys(pattern) {
  if (typeof redis.scan !== 'function') return redis.keys(pattern);
  const found = new Set();
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
    for (const key of batch) found.add(key);
    cursor = String(next);
  } while (cursor !== '0');
  return Array.from(found);
}

class SearchRanking {
  constructor(options = {}) {
    this.weights = {
      relevance: options.relevanceWeight || 0.4,  // 相关性权重
      recency: options.recencyWeight || 0.3,      // 时间新鲜度权重
      popularity: options.popularityWeight || 0.3, // 热度权重
    };
    this.scoreTTL = options.scoreTTL || 3600;
  }

  /**
   * 计算单条消息的相关性分数
   * 基于：标题匹配、内容匹配、精确度
   */
  calcRelevanceScore(message, query, searchContext = {}) {
    let score = 0;
    const queryTokens = query.toLowerCase().split(/\s+/);

    // 1. 精确匹配得分最高 (100 分)
    if (message.content.toLowerCase() === query.toLowerCase()) {
      score += 100;
    } else if (message.content.toLowerCase().startsWith(query.toLowerCase())) {
      // 2. 前缀匹配 (80 分)
      score += 80;
    }

    // 3. token 匹配数量 (每个 token 10 分)
    const contentLower = message.content.toLowerCase();
    queryTokens.forEach(token => {
      if (token.length > 2 && contentLower.includes(token)) {
        score += 10;
      }
    });

    // 4. FTS5 rank 分数 (如果有)
    if (searchContext.ftsRank) {
      score += Math.max(0, 50 - Math.abs(searchContext.ftsRank) * 10);
    }

    // 5. 用户交互信号 (点赞、评论、转发)
    const interactions = (message.likes || 0) * 2 + (message.replies || 0) + (message.forwards || 0) * 3;
    score += Math.min(interactions / 10, 50); // 最多 50 分

    return Math.min(score, 100); // 归一化到 100 分
  }

  /**
   * 计算时间新鲜度分数
   * 最近的消息得分高，指数衰减
   */
  calcRecencyScore(message) {
    const now = Date.now();
    const age = now - message.created_at;
    
    if (age < 1 * DAY) return 100; // 1 天内 100 分
    if (age < 3 * DAY) return 80;  // 3 天内 80 分
    if (age < 7 * DAY) return 60;  // 7 天内 60 分
    if (age < 30 * DAY) return 40; // 30 天内 40 分
    
    // 之后指数衰减
    const monthsAgo = age / (30 * DAY);
    return Math.max(10, 40 * Math.exp(-monthsAgo / 3)); // 最低 10 分
  }

  /**
   * 计算热度分数
   * 基于点赞、评论、转发等社交信号
   */
  calcPopularityScore(message) {
    const likes = message.likes || 0;
    const replies = message.replies || 0;
    const forwards = message.forwards || 0;
    const views = message.views || 0;

    // 计算热度指数
    let popularity = 0;
    popularity += likes * 3;      // 点赞权重 3
    popularity += replies * 5;    // 评论权重 5（更重要）
    popularity += forwards * 7;   // 转发权重 7（最重要）
    popularity += views * 0.1;    // 浏览权重 0.1（低权重）

    // 对数归一化
    const normalizedScore = Math.log(popularity + 1) * 20;
    return Math.min(normalizedScore, 100); // 最高 100 分
  }

  /**
   * 综合排序分数
   */
  calcFinalScore(message, query, context = {}) {
    const relevance = this.calcRelevanceScore(message, query, context);
    const recency = this.calcRecencyScore(message);
    const popularity = this.calcPopularityScore(message);

    const finalScore = 
      relevance * this.weights.relevance +
      recency * this.weights.recency +
      popularity * this.weights.popularity;

    return finalScore;
  }

  /**
   * 排序搜索结果
   */
  rankResults(messages, query, context = {}) {
    if (!messages || messages.length === 0) return [];

    // 计算每条消息的分数
    const ranked = messages.map(msg => ({
      ...msg,
      _searchScore: this.calcFinalScore(msg, query, context),
    }));

    // 按分数排序（从高到低）
    ranked.sort((a, b) => b._searchScore - a._searchScore);

    // 缓存排序结果
    if (query.length > 2) {
      const cacheKey = `search:ranking:${query}`;
      redis.setex(cacheKey, this.scoreTTL, JSON.stringify(
        ranked.slice(0, 100).map(m => ({ id: m.id, score: m._searchScore }))
      )).catch(err => console.error('[Ranking] 缓存失败:', err.message));
    }

    return ranked;
  }

  /**
   * 获取搜索热词排行
   */
  async getSearchTrending(limit = 20) {
    // 防御：非正整数一律按默认值，上限 50（slice 的负数参数会返回几乎全部热词）。
    const n = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 50) : 20;
    try {
      const pattern = 'search:query:*';
      const keys = await redis.keys(pattern);
      
      const trending = {};
      for (const key of keys) {
        const count = await redis.get(key);
        const query = key.replace('search:query:', '');
        trending[query] = parseInt(count) || 0;
      }

      return Object.entries(trending)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([query, count]) => ({ query, count }));
    } catch (err) {
      console.error('[Ranking] 获取热词失败:', err.message);
      return [];
    }
  }

  /**
   * 记录搜索查询
   */
  async recordSearch(query) {
    try {
      if (query.length < 2) return;
      
      const key = `search:query:${query.toLowerCase()}`;
      await redis.incr(key);
      await redis.expire(key, 7 * DAY_S); // 2026-10-11：EXPIRE 取秒，原来传的是毫秒数
    } catch (err) {
      console.error('[Ranking] 记录搜索失败:', err.message);
    }
  }

  /**
   * 获取个性化搜索建议：只来自本人的搜索历史，不混入他人的搜索词（全站热词）。
   */
  async getSearchSuggestions(userId, prefix, limit = 5) {
    const n = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 20) : 5;
    const lowerPrefix = String(prefix || '').toLowerCase();
    try {
      // 用户搜索历史
      const userPattern = `user:search:${userId}:*`;
      const userKeys = await scanKeys(userPattern); // 2026-10-11：SCAN 代替阻塞的 KEYS
      
      const suggestions = [];
      for (const key of userKeys) {
        const query = key.replace(`user:search:${userId}:`, '');
        if (query.toLowerCase().startsWith(lowerPrefix)) {
          const count = await redis.get(key);
          suggestions.push({ query, count: parseInt(count) || 0 });
        }
      }

      return suggestions
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
    } catch (err) {
      console.error('[Ranking] 获取建议失败:', err.message);
      return [];
    }
  }

  /**
   * 记录用户搜索历史
   */
  async recordUserSearch(userId, query) {
    try {
      const key = `user:search:${userId}:${query.toLowerCase()}`;
      await redis.incr(key);
      await redis.expire(key, 30 * DAY_S); // 2026-10-11：EXPIRE 取秒，原来传的是毫秒数（≈82 年）
    } catch (err) {
      console.error('[Ranking] 记录用户搜索失败:', err.message);
    }
  }
}

module.exports = SearchRanking;
