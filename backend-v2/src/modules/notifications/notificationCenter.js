/**
 * 通知中心 - 多渠道统一通知系统
 * 支持: WebSocket、邮件、SMS、钉钉、企业微信、App Push
 */

'use strict';

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db/connection');
const logger = require('../../utils/logger');

// 通知渠道类型
const CHANNELS = {
  WEBSOCKET: 'websocket',      // 实时 WebSocket
  EMAIL: 'email',              // 邮件
  SMS: 'sms',                  // 短信
  DINGTALK: 'dingtalk',        // 钉钉
  WECHAT_WORK: 'wechat_work',  // 企业微信
  APP_PUSH: 'app_push',        // App 推送
};

// 通知优先级
const PRIORITY = {
  CRITICAL: 'critical',  // 关键 - 立即推送所有渠道
  HIGH: 'high',          // 高 - 推送 WebSocket + App
  NORMAL: 'normal',      // 普通 - WebSocket + 邮件
  LOW: 'low',            // 低 - 邮件
};

class NotificationCenter {
  constructor() {
    this.wsConnections = new Map(); // userId -> WebSocket 连接
    this.templateEngine = new TemplateEngine();
    this.frequencyController = new FrequencyController();
  }

  /**
   * 发送通知 - 智能多渠道路由
   */
  async send(userId, notification) {
    const notifId = uuidv4();
    
    try {
      // 1. 验证和规范化通知
      const normalized = this._normalizeNotification(notification);
      
      // 2. 查询用户偏好
      const userPrefs = this._getUserPreferences(userId);
      
      // 3. 频率控制 - 防止轰炸
      if (!this.frequencyController.isAllowed(userId, normalized.type)) {
        logger.info(`Notification throttled: ${userId}/${normalized.type}`);
        return { id: notifId, status: 'throttled' };
      }
      
      // 4. 渠道路由 - 根据优先级和用户偏好选择渠道
      const channels = this._selectChannels(normalized.priority, userPrefs);
      
      // 5. 并行推送所有渠道
      const results = await Promise.allSettled(
        channels.map(ch => this._sendByChannel(userId, normalized, ch))
      );
      
      // 6. 保存通知记录
      this._saveNotificationRecord(userId, notifId, normalized, results);
      
      return { id: notifId, status: 'sent', channels };
    } catch (error) {
      logger.error(`Notification send failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * 按渠道发送
   */
  async _sendByChannel(userId, notification, channel) {
    switch (channel) {
      case CHANNELS.WEBSOCKET:
        return this._sendViaWebSocket(userId, notification);
      case CHANNELS.EMAIL:
        return this._sendViaEmail(userId, notification);
      case CHANNELS.SMS:
        return this._sendViaSMS(userId, notification);
      case CHANNELS.DINGTALK:
        return this._sendViaDingTalk(userId, notification);
      case CHANNELS.WECHAT_WORK:
        return this._sendViaWeChatWork(userId, notification);
      case CHANNELS.APP_PUSH:
        return this._sendViaAppPush(userId, notification);
      default:
        throw new Error(`Unknown channel: ${channel}`);
    }
  }

  /**
   * WebSocket 实时推送 (T+0s)
   */
  async _sendViaWebSocket(userId, notification) {
    const ws = this.wsConnections.get(userId);
    if (!ws || ws.readyState !== 1) return { status: 'no_connection' };
    
    ws.send(JSON.stringify({
      type: 'notification',
      id: uuidv4(),
      data: notification,
      timestamp: Date.now(),
    }));
    
    return { status: 'sent', channel: 'websocket', latency: '0ms' };
  }

  /**
   * 邮件推送 (T+30s)
   */
  async _sendViaEmail(userId, notification) {
    const user = db.prepare('SELECT email FROM users WHERE id=?').get(userId);
    if (!user?.email) return { status: 'no_email' };
    
    const html = this.templateEngine.render('email', notification);
    
    // 发送邮件 (异步)
    setImmediate(() => {
      require('../../services/email').send({
        to: user.email,
        subject: notification.title,
        html,
      }).catch(err => logger.error(`Email send failed: ${err.message}`));
    });
    
    return { status: 'queued', channel: 'email' };
  }

  /**
   * SMS 短信推送 (T+60s) - 使用腾讯云/阿里云
   */
  async _sendViaSMS(userId, notification) {
    const user = db.prepare('SELECT phone FROM users WHERE id=?').get(userId);
    if (!user?.phone) return { status: 'no_phone' };
    
    const message = this.templateEngine.render('sms', notification);
    
    // 发送短信 (异步)
    setImmediate(() => {
      require('../../services/sms').send({
        phoneNumber: user.phone,
        message,
      }).catch(err => logger.error(`SMS send failed: ${err.message}`));
    });
    
    return { status: 'queued', channel: 'sms' };
  }

  /**
   * 钉钉群通知
   */
  async _sendViaDingTalk(userId, notification) {
    const user = db.prepare('SELECT dingtalk_id FROM users WHERE id=?').get(userId);
    if (!user?.dingtalk_id) return { status: 'no_dingtalk_id' };
    
    setImmediate(() => {
      require('../../services/dingtalk').send({
        userId: user.dingtalk_id,
        message: notification.title,
        content: notification.content,
      }).catch(err => logger.error(`DingTalk send failed: ${err.message}`));
    });
    
    return { status: 'queued', channel: 'dingtalk' };
  }

  /**
   * 企业微信通知
   */
  async _sendViaWeChatWork(userId, notification) {
    const user = db.prepare('SELECT wechat_work_id FROM users WHERE id=?').get(userId);
    if (!user?.wechat_work_id) return { status: 'no_wechat_work_id' };
    
    setImmediate(() => {
      require('../../services/wechat-work').send({
        toUser: user.wechat_work_id,
        msgtype: 'text',
        text: { content: notification.title },
      }).catch(err => logger.error(`WeChat Work send failed: ${err.message}`));
    });
    
    return { status: 'queued', channel: 'wechat_work' };
  }

  /**
   * App Push 推送
   */
  async _sendViaAppPush(userId, notification) {
    const tokens = db.prepare(
      'SELECT token, platform FROM device_tokens WHERE user_id=?'
    ).all(userId);
    
    if (tokens.length === 0) return { status: 'no_tokens' };
    
    const pushService = require('../../services/push');
    
    setImmediate(() => {
      tokens.forEach(token => {
        pushService.send(token.platform, token.token, {
          title: notification.title,
          body: notification.content,
          data: notification.data,
        }).catch(err => logger.error(`Push send failed: ${err.message}`));
      });
    });
    
    return { status: 'queued', channel: 'app_push', count: tokens.length };
  }

  /**
   * 选择推送渠道 - 根据优先级和用户偏好
   */
  _selectChannels(priority, userPrefs) {
    const channels = [];
    
    if (priority === PRIORITY.CRITICAL) {
      channels.push(CHANNELS.WEBSOCKET, CHANNELS.APP_PUSH, CHANNELS.EMAIL, CHANNELS.SMS);
    } else if (priority === PRIORITY.HIGH) {
      channels.push(CHANNELS.WEBSOCKET, CHANNELS.APP_PUSH);
      if (userPrefs.emailEnabled) channels.push(CHANNELS.EMAIL);
    } else if (priority === PRIORITY.NORMAL) {
      channels.push(CHANNELS.WEBSOCKET);
      if (userPrefs.emailEnabled) channels.push(CHANNELS.EMAIL);
    } else if (priority === PRIORITY.LOW) {
      if (userPrefs.emailEnabled) channels.push(CHANNELS.EMAIL);
    }
    
    return channels.filter(ch => userPrefs[`${ch}Enabled`] !== false);
  }

  /**
   * 规范化通知
   */
  _normalizeNotification(notification) {
    return {
      id: notification.id || uuidv4(),
      title: notification.title || '系统通知',
      content: notification.content || '',
      type: notification.type || 'general',
      priority: notification.priority || PRIORITY.NORMAL,
      data: notification.data || {},
      createdAt: Date.now(),
    };
  }

  /**
   * 获取用户偏好
   */
  _getUserPreferences(userId) {
    const prefs = db.prepare('SELECT * FROM user_notification_preferences WHERE user_id=?').get(userId) || {};
    
    return {
      emailEnabled: prefs.email_enabled !== false,
      smsEnabled: prefs.sms_enabled !== false,
      dingtalkEnabled: prefs.dingtalk_enabled !== false,
      wechatWorkEnabled: prefs.wechat_work_enabled !== false,
      appPushEnabled: prefs.app_push_enabled !== false,
    };
  }

  /**
   * 保存通知记录
   */
  _saveNotificationRecord(userId, notifId, notification, results) {
    db.prepare(`
      INSERT INTO notification_history (id, user_id, title, content, type, priority, channels, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      notifId,
      userId,
      notification.title,
      notification.content,
      notification.type,
      notification.priority,
      results.filter(r => r.status === 'fulfilled').length,
      results.every(r => r.status === 'fulfilled') ? 'sent' : 'partial',
      Date.now()
    );
  }

  /**
   * 注册 WebSocket 连接
   */
  registerWebSocket(userId, ws) {
    this.wsConnections.set(userId, ws);
    
    ws.on('close', () => {
      this.wsConnections.delete(userId);
    });
  }
}

/**
 * 模板引擎
 */
class TemplateEngine {
  render(type, notification) {
    if (type === 'email') {
      return `
        <h2>${notification.title}</h2>
        <p>${notification.content}</p>
        <p style="color: #999; font-size: 12px;">
          时间: ${new Date(notification.createdAt).toLocaleString()}
        </p>
      `;
    } else if (type === 'sms') {
      return `${notification.title}: ${notification.content}`;
    }
    return JSON.stringify(notification);
  }
}

/**
 * 频率控制器 - 防止通知轰炸
 */
class FrequencyController {
  constructor() {
    this.limits = new Map(); // userId -> {type: timestamp}
  }

  isAllowed(userId, type) {
    const key = `${userId}:${type}`;
    const lastTime = this.limits.get(key) || 0;
    const now = Date.now();
    
    // 同一类型通知 30 秒内最多发一条
    if (now - lastTime < 30000) return false;
    
    this.limits.set(key, now);
    return true;
  }
}

module.exports = {
  NotificationCenter,
  CHANNELS,
  PRIORITY,
};
