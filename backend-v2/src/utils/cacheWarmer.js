'use strict';
/**
 * 缓存预热策略 (P4.6 优化)
 * 启动时预热热数据，减少冷启动延迟
 */

const { db } = require('../db/connection');
const { redis } = require('./redis');

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
      console.log('[CacheWarmer] 开始预热活跃用户...');
      
      const users = db.prepare(`
        SELECT * FROM users 
        ORDER BY last_active DESC 
        LIMIT ?
      `).all(this.maxActiveUsers);

      let cached = 0;
      for (const user of users) {
        const key = `user:${user.id}`;
        await redis.setex(key, this.userTTL, JSON.stringify(user));
        cached++;

        if (cached % 100 === 0) {
          console.log(`[CacheWarmer] 已缓存 ${cached} 个用户`);
        }
      }

      console.log(`[CacheWarmer] 用户预热完成: ${cached} 个`);
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
      console.log('[CacheWarmer] 开始预热热消息...');
      
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
          console.log(`[CacheWarmer] 已缓存 ${cached} 条消息`);
        }
      }

      console.log(`[CacheWarmer] 消息预热完成: ${cached} 条`);
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
      console.log('[CacheWarmer] 开始预热群组...');
      
      const groups = db.prepare(`
        SELECT * FROM groups 
        WHERE deleted = 0
        ORDER BY last_message_time DESC
        LIMIT 500
      `).all();

      let cached = 0;
      for (const group of groups) {
        const key = `group:${group.id}`;
        await redis.setex(key, this.userTTL, JSON.stringify(group));
        
        // 同时预热群成员
        const members = db.prepare(`
          SELECT * FROM group_members 
          WHERE group_id = ?
        `).all(group.id);
        
        const memberKey = `group:${group.id}:members`;
        await redis.setex(memberKey, this.userTTL, JSON.stringify(members));
        
        cached++;
      }

      console.log(`[CacheWarmer] 群组预热完成: ${cached} 个`);
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
      console.log('[CacheWarmer] 开始预热搜索索引...');
      
      const stats = db.prepare(`
        SELECT 
          COUNT(*) as total,
          COUNT(DISTINCT conversation_id) as conversations
        FROM messages
        WHERE deleted = 0
      `).get();

      const key = 'search:index:stats';
      await redis.setex(key, this.userTTL, JSON.stringify(stats));

      console.log(`[CacheWarmer] 搜索索引预热完成: ${stats.total} 条消息`);
      return { stats, type: 'search' };
    } catch (err) {
      console.error('[CacheWarmer] 搜索索引预热失败:', err.message);
      return { stats: null, type: 'search', error: err.message };
    }
  }

  /**
   * 执行全量预热
   */
  async warmAll() {
    const startTime = Date.now();
    console.log('[CacheWarmer] ========== 全量缓存预热开始 ==========');

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

    console.log(`[CacheWarmer] ========== 预热完成 ==========`);
    console.log(`总缓存项: ${results.totalCached}, 耗时: ${results.duration}ms`);

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

    console.log(`[CacheWarmer] 定期预热已启动 (间隔: ${interval}ms)`);
  }

  /**
   * 预热特定用户数据
   */
  async warmUserData(userId) {
    try {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      if (user) {
        await redis.setex(`user:${userId}`, this.userTTL, JSON.stringify(user));
      }

      // 预热用户的会话列表
      const conversations = db.prepare(`
        SELECT * FROM conversations 
        WHERE participant_a = ? OR participant_b = ?
        LIMIT 100
      `).all(userId, userId);

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
