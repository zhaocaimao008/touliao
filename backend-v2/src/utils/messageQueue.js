'use strict';
/**
 * 消息队列与可靠性管理
 * 使用 Redis 实现持久化消息队列、重试机制
 */

const { redis } = require('./redis');

const QUEUE_PREFIX = 'msgqueue:';
const RETRY_PREFIX = 'msgretry:';
const DLQ_PREFIX = 'msgdlq:'; // Dead Letter Queue

/**
 * 消息队列管理类
 */
class MessageQueue {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 5000; // 5 秒
    this.dlqEnabled = options.dlqEnabled !== false;
  }

  /**
   * 入队消息
   * @param {string} queueName - 队列名称
   * @param {Object} message - 消息对象
   * @returns {Promise<string>} 消息 ID
   */
  async enqueue(queueName, message) {
    const queueKey = QUEUE_PREFIX + queueName;
    const msgId = message.id || `${Date.now()}-${Math.random()}`;
    
    const payload = {
      ...message,
      id: msgId,
      enqueuedAt: Date.now(),
      retryCount: 0,
      status: 'pending',
    };

    try {
      // 使用列表存储（LIFO）
      await redis.lpush(queueKey, JSON.stringify(payload));
      
      // 设置过期时间（24 小时）
      await redis.expire(queueKey, 86400);

      console.log(`[Queue] 消息入队: ${queueName}/${msgId}`);
      return msgId;
    } catch (err) {
      console.error('[Queue] 入队失败:', err.message);
      throw err;
    }
  }

  /**
   * 出队消息（阻塞式）
   * @param {string} queueName - 队列名称
   * @param {number} timeoutSec - 阻塞超时（秒）
   * @returns {Promise<Object|null>}
   */
  async dequeue(queueName, timeoutSec = 30) {
    const queueKey = QUEUE_PREFIX + queueName;
    
    try {
      const result = await redis.brpop(queueKey, timeoutSec);
      if (!result) return null;

      const payload = JSON.parse(result[1]);
      return payload;
    } catch (err) {
      console.error('[Queue] 出队失败:', err.message);
      return null;
    }
  }

  /**
   * 标记消息已处理
   * @param {string} messageId - 消息 ID
   */
  async markProcessed(messageId) {
    try {
      const retryKey = RETRY_PREFIX + messageId;
      await redis.del(retryKey);
      console.log(`[Queue] 消息已处理: ${messageId}`);
    } catch (err) {
      console.error('[Queue] 标记失败:', err.message);
    }
  }

  /**
   * 消息处理失败，添加到重试队列
   * @param {string} queueName - 队列名称
   * @param {Object} message - 消息对象
   * @param {Error} error - 错误信息
   * @returns {Promise<boolean>} 是否需要重试
   */
  async markFailed(queueName, message, error) {
    const messageId = message.id;
    const retryKey = RETRY_PREFIX + messageId;

    try {
      // 获取重试次数
      let retryCount = await redis.get(retryKey);
      retryCount = retryCount ? parseInt(retryCount, 10) : 0;

      if (retryCount >= this.maxRetries) {
        // 达到最大重试次数，送到死信队列
        await this._sendToDLQ(queueName, message, error, retryCount);
        console.warn(`[Queue] 消息失败超过最大重试: ${messageId}`);
        return false;
      }

      // 重试计数加 1，设置延迟
      retryCount++;
      const delayMs = this.retryDelayMs * Math.pow(2, retryCount - 1); // 指数退避
      
      await redis.setex(retryKey, Math.ceil(delayMs / 1000), retryCount);

      // 重新入队
      const retryMessage = {
        ...message,
        retryCount,
        lastError: error.message,
        lastFailedAt: Date.now(),
      };

      await this.enqueue(queueName, retryMessage);
      console.log(`[Queue] 消息重试: ${messageId} (${retryCount}/${this.maxRetries})`);
      
      return true;
    } catch (err) {
      console.error('[Queue] 标记失败处理失败:', err.message);
      return false;
    }
  }

  /**
   * 发送到死信队列
   * @private
   */
  async _sendToDLQ(queueName, message, error, retryCount) {
    if (!this.dlqEnabled) return;

    const dlqKey = DLQ_PREFIX + queueName;
    const dlqMessage = {
      ...message,
      dlqReason: error.message,
      dlqTime: Date.now(),
      finalRetryCount: retryCount,
    };

    try {
      await redis.lpush(dlqKey, JSON.stringify(dlqMessage));
      await redis.expire(dlqKey, 604800); // 7 天
      console.warn(`[Queue] 消息送入死信队列: ${queueName}/${message.id}`);
    } catch (err) {
      console.error('[Queue] DLQ 写入失败:', err.message);
    }
  }

  /**
   * 查看死信队列
   * @param {string} queueName - 队列名称
   * @param {number} limit - 数量限制
   * @returns {Promise<Array>}
   */
  async getDLQMessages(queueName, limit = 100) {
    const dlqKey = DLQ_PREFIX + queueName;
    
    try {
      const results = await redis.lrange(dlqKey, 0, limit - 1);
      return results.map(item => JSON.parse(item));
    } catch (err) {
      console.error('[Queue] DLQ 查询失败:', err.message);
      return [];
    }
  }

  /**
   * 清空死信队列
   * @param {string} queueName - 队列名称
   */
  async clearDLQ(queueName) {
    const dlqKey = DLQ_PREFIX + queueName;
    
    try {
      await redis.del(dlqKey);
      console.log(`[Queue] 死信队列已清空: ${queueName}`);
    } catch (err) {
      console.error('[Queue] DLQ 清空失败:', err.message);
    }
  }

  /**
   * 获取队列统计
   * @param {string} queueName - 队列名称
   * @returns {Promise<Object>}
   */
  async getQueueStats(queueName) {
    const queueKey = QUEUE_PREFIX + queueName;
    const dlqKey = DLQ_PREFIX + queueName;

    try {
      const queueLength = await redis.llen(queueKey);
      const dlqLength = await redis.llen(dlqKey);

      return {
        queue: queueName,
        pending: queueLength,
        dlq: dlqLength,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error('[Queue] 统计失败:', err.message);
      return { queue: queueName, pending: 0, dlq: 0, error: err.message };
    }
  }
}

module.exports = MessageQueue;
