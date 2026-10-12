'use strict';
/**
 * 缓存预热策略 (P4.6 优化)
 * 启动时预热热数据，减少冷启动延迟
 */

const { db } = require('../db/connection');
const { redis } = require('./redis');
const { USER_CACHE_COLUMNS } = require('./cache');

// 2026-10-12 安全修复：旧版 warmActiveUsers/warmUserData 用 SELECT * FROM users，把整行（含
// password 哈希、phone）写进 Redis 的 user:<id>。该键的唯一读者 users.service getUserDetail
// 会把缓存值原样展开进用户详情响应；REDIS_URL 带库号使两个客户端落在同一个库时，任何人查看
// 资料都可能拿到对方的密码哈希和手机号。现在只写 USER_CACHE_COLUMNS，并在启动时一次性清理
// 旧版写入的含敏感字段的键（见 purgeLegacySensitiveUserKeys）。
const LEGACY_USER_PURGE_MARKER = 'touliao:maint:cachewarmer-user-purge:v1';
const LEGACY_SENSITIVE_FIELDS = ['password', 'phone'];
// 只匹配 user:<id>；不碰 user:search:<id>:<q>（搜索历史计数）、user:<id>:conversations 等
const PLAIN_USER_KEY = /^user:[^:]+$/;

function isLegacySensitiveUserValue(raw) {
  if (typeof raw !== 'string' || raw[0] !== '{') return false;
  try {
    const v = JSON.parse(raw);
    return !!v && typeof v === 'object' && LEGACY_SENSITIVE_FIELDS.some(f => Object.prototype.hasOwnProperty.call(v, f));
  } catch {
    return false;
  }
}

class CacheWarmer {
  constructor(options = {}) {
    this.maxActiveUsers = options.maxActiveUsers || 1000;
    this.maxHotMessages = options.maxHotMessages || 10000;
    this.hotDays = options.hotDays || 7;
    this.userTTL = options.userTTL || 3600;
    this.messageTTL = options.messageTTL || 600;
  }

  /**
   * 预热活跃用户数据
   */
  async warmActiveUsers() {
    try {
      console.debug('[CacheWarmer] 开始预热活跃用户...');
      
      // 只取 user:<id> 读者需要的公开列（见 utils/cache.js USER_CACHE_COLUMNS），绝不写 password/phone
      const users = db.prepare(`
        SELECT ${USER_CACHE_COLUMNS} FROM users
        ORDER BY created_at DESC
        LIMIT ?
      `).all(this.maxActiveUsers);

      let cached = 0;
      for (const user of users) {
        const key = `user:${user.id}`;
        await redis.setex(key, this.userTTL, JSON.stringify(user));
        cached++;

        if (cached % 100 === 0) {
          console.debug(`[CacheWarmer] 已缓存 ${cached} 个用户`);
        }
      }

      console.debug(`[CacheWarmer] 用户预热完成: ${cached} 个`);
      return { cached, type: 'users' };
    } catch (err) {
      console.error('[CacheWarmer] 用户预热失败:', err.message);
      return { cached: 0, type: 'users', error: err.message };
    }
  }

  /**
   * 预热热消息数据
   */
  async warmHotMessages() {
    try {
      console.debug('[CacheWarmer] 开始预热热消息...');
      
      const cutoffTime = Math.floor((Date.now() - this.hotDays * 86400000) / 1000);
      
      const messages = db.prepare(`
        SELECT * FROM messages 
        WHERE created_at > ? AND deleted = 0
        ORDER BY created_at DESC
        LIMIT ?
      `).all(cutoffTime, this.maxHotMessages);

      let cached = 0;
      for (const msg of messages) {
        const key = `msg:${msg.id}`;
        await redis.setex(key, this.messageTTL, JSON.stringify(msg));
        cached++;

        if (cached % 1000 === 0) {
          console.debug(`[CacheWarmer] 已缓存 ${cached} 条消息`);
        }
      }

      console.debug(`[CacheWarmer] 消息预热完成: ${cached} 条`);
      return { cached, type: 'messages' };
    } catch (err) {
      console.error('[CacheWarmer] 消息预热失败:', err.message);
      return { cached: 0, type: 'messages', error: err.message };
    }
  }

  /**
   * 预热群组数据
   */
  async warmGroups() {
    try {
      console.debug('[CacheWarmer] 开始预热群组...');
      
      const groups = db.prepare(`
        SELECT * FROM conversations
        WHERE type='group'
        ORDER BY created_at DESC
        LIMIT 500
      `).all();

      let cached = 0;
      for (const group of groups) {
        const key = `group:${group.id}`;
        await redis.setex(key, this.userTTL, JSON.stringify(group));
        
        // 同时预热群成员
        const members = db.prepare(`
          SELECT * FROM conversation_members WHERE conversation_id = ?
        `).all(group.id);
        
        const memberKey = `group:${group.id}:members`;
        await redis.setex(memberKey, this.userTTL, JSON.stringify(members));
        
        cached++;
      }

      console.debug(`[CacheWarmer] 群组预热完成: ${cached} 个`);
      return { cached, type: 'groups' };
    } catch (err) {
      console.error('[CacheWarmer] 群组预热失败:', err.message);
      return { cached: 0, type: 'groups', error: err.message };
    }
  }

  /**
   * 预热搜索索引
   */
  async warmSearchIndex() {
    try {
      console.debug('[CacheWarmer] 开始预热搜索索引...');
      
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(DISTINCT conversation_id) as conversations
        FROM messages
        WHERE deleted = 0
      `).get();

      const key = 'search:index:stats';
      await redis.setex(key, this.userTTL, JSON.stringify(stats));

      console.debug(`[CacheWarmer] 搜索索引预热完成: ${stats.total} 条消息`);
      return { stats, type: 'search' };
    } catch (err) {
      console.error('[CacheWarmer] 搜索索引预热失败:', err.message);
      return { stats: null, type: 'search', error: err.message };
    }
  }

  /**
   * 一次性清理旧版预热写入的 user:<id>（值里含 password/phone 的整行）。
   * - 只在配置了 Redis 时由 server.js 调用（client 为 integrations/redisCache 的 ioredis 客户端，
   *   即 CacheWarmer 写入的同一个库）；
   * - SCAN + MGET + DEL，只删值是 JSON 对象且含敏感字段的 user:<id>，不 FLUSH、不碰其他键；
   * - 成功后写标记键，之后启动直接跳过；失败不写标记，下次启动重试。可重复执行（幂等）。
   * 旧键本身 TTL 为 1 小时，这里是为了上线后立即清掉，而不是等它们过期。
   */
  async purgeLegacySensitiveUserKeys(client, { scanCount = 500 } = {}) {
    if (!client || typeof client.scan !== 'function') return { skipped: 'no-redis' };
    try {
      if (await client.get(LEGACY_USER_PURGE_MARKER)) return { skipped: 'already-done' };
      let cursor = '0';
      let checked = 0;
      let deleted = 0;
      do {
        const [next, keys] = await client.scan(cursor, 'MATCH', 'user:*', 'COUNT', scanCount);
        cursor = String(next);
        const candidates = (keys || []).filter(k => PLAIN_USER_KEY.test(k));
        if (candidates.length === 0) continue;
        checked += candidates.length;
        const values = await client.mget(...candidates);   // 非 string 类型的键 MGET 返回 nil
        const doomed = candidates.filter((_, i) => isLegacySensitiveUserValue(values[i]));
        if (doomed.length) deleted += Number(await client.del(...doomed)) || 0;
      } while (cursor !== '0');
      await client.set(LEGACY_USER_PURGE_MARKER, String(Date.now()));
      console.log(`[CacheWarmer] 已清理旧版预热写入的含敏感字段的 user:<id> 缓存：检查 ${checked} 个，删除 ${deleted} 个`);
      return { checked, deleted };
    } catch (err) {
      console.warn('[CacheWarmer] 清理旧版 user:<id> 缓存失败（下次启动重试）:', err.message);
      return { error: err.message };
    }
  }

  /**
   * 执行全量预热
   */
  async warmAll() {
    const startTime = Date.now();
    console.debug('[CacheWarmer] ========== 全量缓存预热开始 ==========');

    const results = {
      startTime,
      items: [],
      totalCached: 0,
      duration: 0,
    };

    // 并行预热
    const warmers = [
      this.warmActiveUsers(),
      this.warmHotMessages(),
      this.warmGroups(),
      this.warmSearchIndex(),
    ];

    const warmResults = await Promise.all(warmers);
    results.items = warmResults;
    results.totalCached = warmResults.reduce((sum, r) => sum + (r.cached || 0), 0);
    results.duration = Date.now() - startTime;

    console.debug(`[CacheWarmer] ========== 预热完成 ==========`);
    console.debug(`总缓存项: ${results.totalCached}, 耗时: ${results.duration}ms`);

    return results;
  }

  /**
   * 定期更新热数据缓存
   */
  startPeriodicWarming(interval = 60 * 60 * 1000) { // 默认 1 小时
    setInterval(() => {
      this.warmAll().catch(err => {
        console.error('[CacheWarmer] 定期预热失败:', err.message);
      });
    }, interval).unref();

    console.debug(`[CacheWarmer] 定期预热已启动 (间隔: ${interval}ms)`);
  }

  /**
   * 预热特定用户数据
   */
  async warmUserData(userId) {
    try {
      // 同 warmActiveUsers：只取公开列（该返回值还会经 /api/optimization/cache/warm-user 回给客户端）
      const user = db.prepare(`SELECT ${USER_CACHE_COLUMNS} FROM users WHERE id = ?`).get(userId);
      if (user) {
        await redis.setex(`user:${userId}`, this.userTTL, JSON.stringify(user));
      }

      // 预热用户的会话列表
      // 原 SQL 用不存在的 participant_a/participant_b 列，一直抛 "no such column"，整个函数返回 null
      // （连带用户资料也没预热）。会话成员关系在 conversation_members。
      const conversations = db.prepare(`
        SELECT c.* FROM conversations c
        JOIN conversation_members m ON m.conversation_id = c.id
        WHERE m.user_id = ?
        LIMIT 100
      `).all(userId);

      const convKey = `user:${userId}:conversations`;
      await redis.setex(convKey, this.userTTL, JSON.stringify(conversations));

      return { user, conversationCount: conversations.length };
    } catch (err) {
      console.error('[CacheWarmer] 用户数据预热失败:', err.message);
      return null;
    }
  }
}

module.exports = CacheWarmer;
module.exports.LEGACY_USER_PURGE_MARKER = LEGACY_USER_PURGE_MARKER;
module.exports.isLegacySensitiveUserValue = isLegacySensitiveUserValue;
