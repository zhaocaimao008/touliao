/**
 * 通知队列 - 使用 Redis 进行异步处理
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { redis } = require('../../utils/redis');
const logger = require('../../utils/logger');

const NOTIFICATION_QUEUE = 'notifications:queue';
const NOTIFICATION_DLQ = 'notifications:dlq'; // 死信队列
const RETRY_KEY = 'notifications:retry:';

class NotificationQueue {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 5000;
    this.processing = false;
  }

  /**
   * 入队通知
   */
  async enqueue(userId, notification) {
    const notifId = uuidv4();
    const item = {
      id: notifId,
      userId,
      notification,
      createdAt: Date.now(),
      retries: 0,
    };

    try {
      await redis.lpush(NOTIFICATION_QUEUE, JSON.stringify(item));
      logger.info(`Notification queued: ${notifId}`);
      return { id: notifId, status: 'queued' };
    } catch (error) {
      logger.error(`Failed to enqueue notification: ${error.message}`);
      throw error;
    }
  }

  /**
   * 开始处理队列
   */
  async startProcessing() {
    if (this.processing) return;
    this.processing = true;

    // 注意：避免用 'process' 命名，防止遮蔽 Node.js 全局 process 对象
    const processNext = async () => {
      try {
        const item = await redis.rpop(NOTIFICATION_QUEUE);
        if (!item) {
          // 队列为空，1秒后重试
          setTimeout(processNext, 1000);
          return;
        }

        const notification = JSON.parse(item);
        await this._processNotification(notification);

        // 继续处理下一条
        setImmediate(processNext);
      } catch (error) {
        logger.error(`Queue processing error: ${error.message}`);
        setTimeout(processNext, 5000);
      }
    };

    processNext();
  }

  /**
   * 处理单条通知
   */
  async _processNotification(item) {
    try {
      const notificationCenter = require('./notificationCenter').NotificationCenter;
      const nc = new notificationCenter();
      
      await nc.send(item.userId, item.notification);
      logger.info(`Notification processed: ${item.id}`);
    } catch (error) {
      item.retries++;
      
      if (item.retries >= this.maxRetries) {
        // 超过重试次数，进入死信队列
        await redis.lpush(NOTIFICATION_DLQ, JSON.stringify(item));
        logger.error(`Notification moved to DLQ: ${item.id}`);
      } else {
        // 重新入队等待重试
        const retryKey = `${RETRY_KEY}${item.id}`;
        await redis.setex(retryKey, this.retryDelayMs / 1000, '1');
        
        setTimeout(async () => {
          await redis.lpush(NOTIFICATION_QUEUE, JSON.stringify(item));
        }, this.retryDelayMs);
        
        logger.warn(`Notification retry scheduled: ${item.id} (attempt ${item.retries})`);
      }
    }
  }

  /**
   * 获取死信队列消息
   */
  async getDLQMessages() {
    try {
      const messages = await redis.lrange(NOTIFICATION_DLQ, 0, -1);
      return messages.map(m => JSON.parse(m));
    } catch (error) {
      logger.error(`Failed to get DLQ messages: ${error.message}`);
      return [];
    }
  }

  /**
   * 清空死信队列
   */
  async clearDLQ() {
    try {
      await redis.del(NOTIFICATION_DLQ);
      logger.info('DLQ cleared');
    } catch (error) {
      logger.error(`Failed to clear DLQ: ${error.message}`);
    }
  }
}

module.exports = NotificationQueue;
