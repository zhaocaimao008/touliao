'use strict';
/**
 * Redis 高级缓存工具
 * 用于用户在线状态、好友列表、未读计数等高频数据缓存
 */

const { redis } = require('./redis');

/**
 * 用户在线状态管理
 */
class OnlineStatusCache {
  constructor() {
    this.prefix = 'online:';
    this.ttl = 90; // 90 秒超时（心跳间隔 30s，允许 3 次丢失）
  }

  /**
   * 设置用户在线
   * @param {string} userId - 用户 ID
   * @param {Object} metadata - 元数据（设备类型、IP 等）
   */
  async setOnline(userId, metadata = {}) {
    const key = this.prefix + userId;
    const data = {
      userId,
      lastSeen: Date.now(),
      ...metadata,
    };
    await redis.setex(key, this.ttl, JSON.stringify(data));
  }

  /**
   * 获取用户在线状态
   * @param {string} userId - 用户 ID
   * @returns {Object|null} 在线数据或 null
   */
  async getOnline(userId) {
    const key = this.prefix + userId;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 批量获取用户在线状态
   * @param {Array<string>} userIds - 用户 ID 列表
   * @returns {Object} userId -> 在线数据的映射
   */
  async batchGetOnline(userIds) {
    if (!userIds || userIds.length === 0) return {};
    
    const keys = userIds.map(id => this.prefix + id);
    const results = await redis.mget(...keys);
    
    const statusMap = {};
    userIds.forEach((userId, index) => {
      if (results[index]) {
        statusMap[userId] = JSON.parse(results[index]);
      }
    });
    
    return statusMap;
  }

  /**
   * 设置用户离线
   * @param {string} userId - 用户 ID
   */
  async setOffline(userId) {
    const key = this.prefix + userId;
    await redis.del(key);
  }

  /**
   * 获取所有在线用户数量
   * @returns {number} 在线用户数
   */
  async getOnlineCount() {
    const keys = await redis.keys(this.prefix + '*');
    return keys.length;
  }
}

/**
 * 好友列表缓存
 */
class FriendsCache {
  constructor() {
    this.prefix = 'friends:';
    this.ttl = 1800; // 30 分钟
  }

  /**
   * 缓存用户好友列表
   * @param {string} userId - 用户 ID
   * @param {Array} friends - 好友列表
   */
  async set(userId, friends) {
    const key = this.prefix + userId;
    await redis.setex(key, this.ttl, JSON.stringify(friends));
  }

  /**
   * 获取用户好友列表
   * @param {string} userId - 用户 ID
   * @returns {Array|null} 好友列表或 null
   */
  async get(userId) {
    const key = this.prefix + userId;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 使缓存失效
   * @param {string} userId - 用户 ID
   */
  async invalidate(userId) {
    const key = this.prefix + userId;
    await redis.del(key);
  }

  /**
   * 批量使缓存失效
   * @param {Array<string>} userIds - 用户 ID 列表
   */
  async batchInvalidate(userIds) {
    if (!userIds || userIds.length === 0) return;
    const keys = userIds.map(id => this.prefix + id);
    await redis.del(...keys);
  }
}

/**
 * 未读消息计数缓存
 */
class UnreadCountCache {
  constructor() {
    this.prefix = 'unread:';
    this.ttl = 3600; // 1 小时
  }

  /**
   * 增加未读计数
   * @param {string} userId - 用户 ID
   * @param {string} conversationId - 会话 ID
   * @param {number} count - 增加数量
   */
  async increment(userId, conversationId, count = 1) {
    const key = `${this.prefix}${userId}:${conversationId}`;
    await redis.incrby(key, count);
    await redis.expire(key, this.ttl);
  }

  /**
   * 获取未读计数
   * @param {string} userId - 用户 ID
   * @param {string} conversationId - 会话 ID
   * @returns {number} 未读数量
   */
  async get(userId, conversationId) {
    const key = `${this.prefix}${userId}:${conversationId}`;
    const count = await redis.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  /**
   * 清零未读计数
   * @param {string} userId - 用户 ID
   * @param {string} conversationId - 会话 ID
   */
  async clear(userId, conversationId) {
    const key = `${this.prefix}${userId}:${conversationId}`;
    await redis.del(key);
  }

  /**
   * 获取用户所有会话的未读计数
   * @param {string} userId - 用户 ID
   * @returns {Object} conversationId -> count 的映射
   */
  async getAllForUser(userId) {
    const pattern = `${this.prefix}${userId}:*`;
    const keys = await redis.keys(pattern);
    
    if (keys.length === 0) return {};
    
    const counts = await redis.mget(...keys);
    const result = {};
    
    keys.forEach((key, index) => {
      const conversationId = key.split(':')[2];
      result[conversationId] = counts[index] ? parseInt(counts[index], 10) : 0;
    });
    
    return result;
  }

  /**
   * 获取用户总未读数
   * @param {string} userId - 用户 ID
   * @returns {number} 总未读数
   */
  async getTotalForUser(userId) {
    const allCounts = await this.getAllForUser(userId);
    return Object.values(allCounts).reduce((sum, count) => sum + count, 0);
  }
}

/**
 * 会话列表缓存
 */
class ConversationsCache {
  constructor() {
    this.prefix = 'conversations:';
    this.ttl = 600; // 10 分钟
  }

  /**
   * 缓存用户会话列表
   * @param {string} userId - 用户 ID
   * @param {Array} conversations - 会话列表
   */
  async set(userId, conversations) {
    const key = this.prefix + userId;
    await redis.setex(key, this.ttl, JSON.stringify(conversations));
  }

  /**
   * 获取用户会话列表
   * @param {string} userId - 用户 ID
   * @returns {Array|null} 会话列表或 null
   */
  async get(userId) {
    const key = this.prefix + userId;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 使缓存失效
   * @param {string} userId - 用户 ID
   */
  async invalidate(userId) {
    const key = this.prefix + userId;
    await redis.del(key);
  }
}

/**
 * 用户信息缓存
 */
class UserInfoCache {
  constructor() {
    this.prefix = 'user:';
    this.ttl = 3600; // 1 小时
  }

  /**
   * 缓存用户信息
   * @param {string} userId - 用户 ID
   * @param {Object} userInfo - 用户信息
   */
  async set(userId, userInfo) {
    const key = this.prefix + userId;
    await redis.setex(key, this.ttl, JSON.stringify(userInfo));
  }

  /**
   * 获取用户信息
   * @param {string} userId - 用户 ID
   * @returns {Object|null} 用户信息或 null
   */
  async get(userId) {
    const key = this.prefix + userId;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 批量获取用户信息
   * @param {Array<string>} userIds - 用户 ID 列表
   * @returns {Object} userId -> userInfo 的映射
   */
  async batchGet(userIds) {
    if (!userIds || userIds.length === 0) return {};
    
    const keys = userIds.map(id => this.prefix + id);
    const results = await redis.mget(...keys);
    
    const userMap = {};
    userIds.forEach((userId, index) => {
      if (results[index]) {
        userMap[userId] = JSON.parse(results[index]);
      }
    });
    
    return userMap;
  }

  /**
   * 使缓存失效
   * @param {string} userId - 用户 ID
   */
  async invalidate(userId) {
    const key = this.prefix + userId;
    await redis.del(key);
  }
}

// 导出实例
const onlineStatusCache = new OnlineStatusCache();
const friendsCache = new FriendsCache();
const unreadCountCache = new UnreadCountCache();
const conversationsCache = new ConversationsCache();
const userInfoCache = new UserInfoCache();

module.exports = {
  onlineStatusCache,
  friendsCache,
  unreadCountCache,
  conversationsCache,
  userInfoCache,
  OnlineStatusCache,
  FriendsCache,
  UnreadCountCache,
  ConversationsCache,
  UserInfoCache,
};
