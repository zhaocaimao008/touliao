'use strict';
/**
 * 消息 ACK 确认管理
 * 追踪消息的送达和已读状态
 */

const { redis } = require('./redis');

const ACK_PREFIX = 'ack:'; // ack:messageId:userId -> timestamp
const DELIVERY_PREFIX = 'delivery:'; // delivery:messageId -> Set<userId>
const READ_PREFIX = 'read:'; // read:messageId -> Set<userId>

/**
 * ACK 管理器
 */
class AckManager {
  constructor(options = {}) {
    this.ackTtl = options.ackTtl || 86400; // 24 小时
  }

  /**
   * 记录消息送达确认
   * @param {string} messageId - 消息 ID
   * @param {string} userId - 用户 ID
   * @param {number} timestamp - 时间戳
   */
  async recordDelivery(messageId, userId, timestamp = Date.now()) {
    try {
      const deliveryKey = DELIVERY_PREFIX + messageId;
      await redis.sadd(deliveryKey, userId);
      await redis.expire(deliveryKey, this.ackTtl);

      // 记录具体送达时间
      const ackKey = ACK_PREFIX + messageId + ':' + userId + ':delivery';
      await redis.setex(ackKey, this.ackTtl, timestamp);

      console.log(`[ACK] 送达确认: ${messageId} -> ${userId}`);
    } catch (err) {
      console.error('[ACK] 记录送达失败:', err.message);
    }
  }

  /**
   * 记录消息已读确认
   * @param {string} messageId - 消息 ID
   * @param {string} userId - 用户 ID
   * @param {number} timestamp - 时间戳
   */
  async recordRead(messageId, userId, timestamp = Date.now()) {
    try {
      const readKey = READ_PREFIX + messageId;
      await redis.sadd(readKey, userId);
      await redis.expire(readKey, this.ackTtl);

      // 记录具体已读时间
      const ackKey = ACK_PREFIX + messageId + ':' + userId + ':read';
      await redis.setex(ackKey, this.ackTtl, timestamp);

      console.log(`[ACK] 已读确认: ${messageId} -> ${userId}`);
    } catch (err) {
      console.error('[ACK] 记录已读失败:', err.message);
    }
  }

  /**
   * 获取消息送达用户列表
   * @param {string} messageId - 消息 ID
   * @returns {Promise<Array<string>>} 用户 ID 列表
   */
  async getDeliveredUsers(messageId) {
    try {
      const deliveryKey = DELIVERY_PREFIX + messageId;
      const users = await redis.smembers(deliveryKey);
      return users || [];
    } catch (err) {
      console.error('[ACK] 获取送达用户失败:', err.message);
      return [];
    }
  }

  /**
   * 获取消息已读用户列表
   * @param {string} messageId - 消息 ID
   * @returns {Promise<Array<string>>} 用户 ID 列表
   */
  async getReadUsers(messageId) {
    try {
      const readKey = READ_PREFIX + messageId;
      const users = await redis.smembers(readKey);
      return users || [];
    } catch (err) {
      console.error('[ACK] 获取已读用户失败:', err.message);
      return [];
    }
  }

  /**
   * 获取消息 ACK 状态
   * @param {string} messageId - 消息 ID
   * @param {Array<string>} targetUserIds - 目标用户 ID 列表
   * @returns {Promise<Object>} { delivered, read, pending }
   */
  async getMessageAckStatus(messageId, targetUserIds = []) {
    try {
      const delivered = await this.getDeliveredUsers(messageId);
      const read = await this.getReadUsers(messageId);

      const deliveredSet = new Set(delivered);
      const readSet = new Set(read);

      const status = {
        messageId,
        delivered: delivered.length,
        read: read.length,
        pending: targetUserIds.length - delivered.length,
        details: {},
      };

      if (targetUserIds.length > 0) {
        targetUserIds.forEach(userId => {
          status.details[userId] = {
            delivered: deliveredSet.has(userId),
            read: readSet.has(userId),
          };
        });
      }

      return status;
    } catch (err) {
      console.error('[ACK] 获取状态失败:', err.message);
      return { messageId, delivered: 0, read: 0, pending: 0, details: {} };
    }
  }

  /**
   * 批量获取消息 ACK 状态
   * @param {Array<string>} messageIds - 消息 ID 列表
   * @returns {Promise<Array>}
   */
  async getMultipleMessageAckStatus(messageIds) {
    try {
      const results = await Promise.all(
        messageIds.map(msgId => this.getMessageAckStatus(msgId))
      );
      return results;
    } catch (err) {
      console.error('[ACK] 批量获取失败:', err.message);
      return [];
    }
  }

  /**
   * 清除消息的 ACK 数据
   * @param {string} messageId - 消息 ID
   */
  async clearMessageAck(messageId) {
    try {
      const deliveryKey = DELIVERY_PREFIX + messageId;
      const readKey = READ_PREFIX + messageId;
      
      await redis.del(deliveryKey, readKey);
      
      // 删除所有相关 ack 记录
      const pattern = ACK_PREFIX + messageId + ':*';
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }

      console.log(`[ACK] 消息 ACK 数据已清除: ${messageId}`);
    } catch (err) {
      console.error('[ACK] 清除失败:', err.message);
    }
  }

  /**
   * 获取用户的 ACK 统计
   * @param {string} userId - 用户 ID
   * @returns {Promise<Object>}
   */
  async getUserAckStats(userId) {
    try {
      // 查找该用户相关的所有 ACK
      const pattern = ACK_PREFIX + '*:' + userId + ':*';
      const keys = await redis.keys(pattern);

      const stats = {
        userId,
        totalAcks: keys.length,
        delivered: 0,
        read: 0,
      };

      keys.forEach(key => {
        if (key.endsWith(':delivery')) stats.delivered++;
        else if (key.endsWith(':read')) stats.read++;
      });

      return stats;
    } catch (err) {
      console.error('[ACK] 用户统计失败:', err.message);
      return { userId, totalAcks: 0, delivered: 0, read: 0 };
    }
  }
}

module.exports = AckManager;
