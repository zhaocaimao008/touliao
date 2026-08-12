'use strict';
/**
 * 消息去重处理 (P4.4 优化)
 * 防止网络重试导致的消息重复
 */

const { redis } = require('./redis');

class MessageDeduplicator {
  constructor(options = {}) {
    this.dedup_ttl = options.dedupTTL || 24 * 3600; // 24 小时
    this.prefix = 'dedup:';
  }

  /**
   * 生成去重 key
   * 基于用户、消息 ID、内容哈希
   */
  generateDedupKey(userId, clientMsgId) {
    return `${this.prefix}${userId}:${clientMsgId}`;
  }

  /**
   * 检查消息是否重复
   */
  async isDuplicate(userId, clientMsgId) {
    try {
      const key = this.generateDedupKey(userId, clientMsgId);
      const isDup = await redis.exists(key);
      return isDup === 1;
    } catch (err) {
      console.error('[Dedup] 检查重复失败:', err.message);
      return false;
    }
  }

  /**
   * 标记消息已处理（防重复）
   */
  async markProcessed(userId, clientMsgId, metadata = {}) {
    try {
      const key = this.generateDedupKey(userId, clientMsgId);
      const data = JSON.stringify({
        processedAt: Date.now(),
        ...metadata,
      });
      
      await redis.setex(key, this.dedup_ttl, data);
      console.log(`[Dedup] 消息已标记: ${userId}:${clientMsgId}`);
    } catch (err) {
      console.error('[Dedup] 标记失败:', err.message);
    }
  }

  /**
   * 获取已处理消息的元数据
   */
  async getProcessedMetadata(userId, clientMsgId) {
    try {
      const key = this.generateDedupKey(userId, clientMsgId);
      const data = await redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error('[Dedup] 获取元数据失败:', err.message);
      return null;
    }
  }

  /**
   * 批量检查重复消息
   */
  async checkDuplicates(userId, clientMsgIds = []) {
    try {
      const results = {};
      for (const id of clientMsgIds) {
        results[id] = await this.isDuplicate(userId, id);
      }
      return results;
    } catch (err) {
      console.error('[Dedup] 批量检查失败:', err.message);
      return {};
    }
  }

  /**
   * 清除用户的去重记录（注销时）
   */
  async clearUserDedup(userId) {
    try {
      const pattern = `${this.prefix}${userId}:*`;
      const keys = await redis.keys(pattern);
      
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`[Dedup] 已清除用户去重记录: ${userId} (${keys.length} 条)`);
      }
    } catch (err) {
      console.error('[Dedup] 清除记录失败:', err.message);
    }
  }

  /**
   * 获取去重统计
   */
  async getStats() {
    try {
      const pattern = `${this.prefix}*`;
      const keys = await redis.keys(pattern);
      
      const stats = {
        totalDedup: keys.length,
        byUser: {},
      };

      // 按用户统计
      for (const key of keys) {
        const userId = key.split(':')[1];
        stats.byUser[userId] = (stats.byUser[userId] || 0) + 1;
      }

      return stats;
    } catch (err) {
      console.error('[Dedup] 获取统计失败:', err.message);
      return { totalDedup: 0, byUser: {} };
    }
  }
}

module.exports = MessageDeduplicator;
