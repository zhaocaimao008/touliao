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
    // 队列为空时的轮询间隔（与失败重试间隔分开：空队列是正常状态，失败不是）
    this.idlePollMs = options.idlePollMs || 1000;
    this.processing = false;
    this.stopped = false;
    // 连续失败计数：Redis 客户端不可用时不该一直空转刷 error 日志，见 startProcessing
    this._consecutiveErrors = 0;
  }

  /** 停止轮询。优雅退出时必须调用，否则见 startProcessing 里的说明。 */
  stop() {
    this.stopped = true;
    this.processing = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
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
  // ⚠ 这个轮询此前没有任何停止手段，也没有失败上限：
  //   · graceful() 里 await redisCache.disconnect() 之后，本轮询还在跑，
  //     每 5 秒对着一个已 quit 的客户端 rpop 一次，抛 "Connection is closed."
  //     并以 **error** 级别写进 error.log / Sentry。生产日志实测 57 条全是这个，
  //     且全部产生在关停窗口里（该服务重启过 163 次）。
  //   · Redis 真的挂掉时同样会无休止刷下去，把真事故淹掉。
  // 现在：可 stop()（server.js 的 graceful 里调用），且连续失败到上限就停并只留一行 warn。
  async startProcessing() {
    if (this.processing || this.stopped) return;
    this.processing = true;

    // 注意：避免用 'process' 命名，防止遮蔽 Node.js 全局 process 对象
    const MAX_CONSECUTIVE_ERRORS = 5;
    const processNext = async () => {
      if (this.stopped) return;
      try {
        if (!redis) {   // 生产环境无可用客户端时 getRedisClient() 返回 null
          this.processing = false;
          logger.warn('[notificationQueue] 无可用 Redis 客户端，队列轮询未启动');
          return;
        }
        const item = await redis.rpop(NOTIFICATION_QUEUE);
        this._consecutiveErrors = 0;
        if (!item) {
          // 队列为空，1秒后重试
          this._timer = setTimeout(processNext, this.idlePollMs);
          return;
        }

        const notification = JSON.parse(item);
        await this._processNotification(notification);

        // 继续处理下一条
        setImmediate(processNext);
      } catch (error) {
        this._consecutiveErrors += 1;
        if (this._consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          // 连续失败到上限：停掉轮询，只留一行 warn。继续空转除了刷日志没有任何作用，
          // 而 error 级别的重复噪音会把真正的事故淹掉。
          this.processing = false;
          logger.warn(`[notificationQueue] 连续 ${MAX_CONSECUTIVE_ERRORS} 次失败，停止轮询: ${error.message}`);
          return;
        }
        logger.warn(`[notificationQueue] 处理失败(${this._consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error.message}`);
        // 用构造器传入的 retryDelayMs，而不是写死 5000——这个选项本来就存在
        // （server.js 传的就是 5000），却被轮询忽略了。
        this._timer = setTimeout(processNext, this.retryDelayMs);
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
