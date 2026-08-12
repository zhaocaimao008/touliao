'use strict';
/**
 * 批量 ACK 管理 (P4.5 优化)
 * 合并多个 ACK 请求，减少网络往返
 */

const { redis } = require('./redis');
const AckManager = require('./ackManager');

class BatchAckManager extends AckManager {
  constructor(options = {}) {
    super(options);
    this.batchSize = options.batchSize || 50;
    this.batchTimeout = options.batchTimeout || 1000; // 1 秒
    this.pendingBatches = new Map();
  }

  /**
   * 添加 ACK 到待处理队列
   */
  async addToBatch(type, messageId, userId, timestamp = Date.now()) {
    const batchKey = `batch:${type}:${userId}`;
    
    if (!this.pendingBatches.has(batchKey)) {
      this.pendingBatches.set(batchKey, {
        type,
        userId,
        items: [],
        timer: null,
      });
    }

    const batch = this.pendingBatches.get(batchKey);
    batch.items.push({ messageId, timestamp });

    // 如果达到批量大小，立即处理
    if (batch.items.length >= this.batchSize) {
      return this.processBatch(batchKey);
    }

    // 否则设置超时处理
    if (!batch.timer) {
      batch.timer = setTimeout(() => {
        this.processBatch(batchKey);
      }, this.batchTimeout);
    }

    return { queued: true, batchSize: batch.items.length };
  }

  /**
   * 处理待处理的批量请求
   */
  async processBatch(batchKey) {
    const batch = this.pendingBatches.get(batchKey);
    if (!batch) return;

    try {
      if (batch.timer) {
        clearTimeout(batch.timer);
        batch.timer = null;
      }

      const { type, userId, items } = batch;

      // 批量保存到 Redis
      const pipeline = redis.pipeline();

      for (const item of items) {
        if (type === 'delivery') {
          const deliveryKey = `delivery:${item.messageId}`;
          pipeline.sadd(deliveryKey, userId);
          pipeline.expire(deliveryKey, this.ackTtl);

          const ackKey = `ack:${item.messageId}:${userId}:delivery`;
          pipeline.setex(ackKey, this.ackTtl, item.timestamp);
        } else if (type === 'read') {
          const readKey = `read:${item.messageId}`;
          pipeline.sadd(readKey, userId);
          pipeline.expire(readKey, this.ackTtl);

          const ackKey = `ack:${item.messageId}:${userId}:read`;
          pipeline.setex(ackKey, this.ackTtl, item.timestamp);
        }
      }

      await pipeline.exec();
      console.log(`[BatchACK] 处理完成: ${type} x${items.length} (user: ${userId})`);

      this.pendingBatches.delete(batchKey);
      return { processed: items.length, type };
    } catch (err) {
      console.error('[BatchACK] 处理失败:', err.message);
      this.pendingBatches.delete(batchKey);
    }
  }

  /**
   * 批量记录送达确认
   */
  async batchRecordDelivery(userId, messageIds = []) {
    const results = [];
    for (const msgId of messageIds) {
      const result = await this.addToBatch('delivery', msgId, userId);
      results.push(result);
    }
    return results;
  }

  /**
   * 批量记录已读确认
   */
  async batchRecordRead(userId, messageIds = []) {
    const results = [];
    for (const msgId of messageIds) {
      const result = await this.addToBatch('read', msgId, userId);
      results.push(result);
    }
    return results;
  }

  /**
   * 获取待处理批次统计
   */
  getStats() {
    const stats = {
      totalPending: this.pendingBatches.size,
      batches: [],
    };

    for (const [key, batch] of this.pendingBatches) {
      stats.batches.push({
        key,
        type: batch.type,
        userId: batch.userId,
        itemCount: batch.items.length,
        hasTimer: !!batch.timer,
      });
    }

    return stats;
  }

  /**
   * 强制处理所有待处理批次
   */
  async flushAll() {
    const keys = Array.from(this.pendingBatches.keys());
    const results = [];

    for (const key of keys) {
      const result = await this.processBatch(key);
      results.push(result);
    }

    return results;
  }
}

module.exports = BatchAckManager;
