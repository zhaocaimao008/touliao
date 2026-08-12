/**
 * 通知系统扩展路由
 */

'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { NotificationCenter } = require('./notificationCenter');
const NotificationQueue = require('./notificationQueue');
const NotificationTemplate = require('./notificationTemplate');
const { db } = require('../../db/connection');

const router = express.Router();
const nc = new NotificationCenter();
const nq = new NotificationQueue();

/**
 * 发送通知
 */
router.post('/send', authenticate, async (req, res) => {
  try {
    const { userId, title, content, type, priority, data } = req.body;
    
    const result = await nc.send(userId || req.user.id, {
      title,
      content,
      type,
      priority,
      data,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取通知历史
 */
router.get('/history', authenticate, (req, res) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    
    const history = db.prepare(`
      SELECT * FROM notification_history 
      WHERE user_id = ? 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `).all(req.user.id, parseInt(limit), parseInt(offset));

    const total = db.prepare(
      'SELECT COUNT(*) as count FROM notification_history WHERE user_id = ?'
    ).get(req.user.id).count;

    res.json({ history, total });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取用户通知偏好
 */
router.get('/preferences', authenticate, (req, res) => {
  try {
    const prefs = db.prepare(
      'SELECT * FROM user_notification_preferences WHERE user_id = ?'
    ).get(req.user.id) || {};

    res.json(prefs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 更新用户通知偏好
 */
router.put('/preferences', authenticate, (req, res) => {
  try {
    const { emailEnabled, smsEnabled, dingtalkEnabled, wechatWorkEnabled, appPushEnabled } = req.body;
    
    db.prepare(`
      INSERT INTO user_notification_preferences 
      (user_id, email_enabled, sms_enabled, dingtalk_enabled, wechat_work_enabled, app_push_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET 
        email_enabled = ?, sms_enabled = ?, dingtalk_enabled = ?, wechat_work_enabled = ?, app_push_enabled = ?, updated_at = ?
    `).run(
      req.user.id,
      emailEnabled ? 1 : 0,
      smsEnabled ? 1 : 0,
      dingtalkEnabled ? 1 : 0,
      wechatWorkEnabled ? 1 : 0,
      appPushEnabled ? 1 : 0,
      Date.now(),
      Date.now(),
      emailEnabled ? 1 : 0,
      smsEnabled ? 1 : 0,
      dingtalkEnabled ? 1 : 0,
      wechatWorkEnabled ? 1 : 0,
      appPushEnabled ? 1 : 0,
      Date.now()
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 保存设备token
 */
router.post('/device-token', authenticate, (req, res) => {
  try {
    const { token, platform, deviceName } = req.body;
    
    db.prepare(`
      INSERT INTO device_tokens (id, user_id, token, platform, device_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, token, platform) DO UPDATE SET 
        device_name = ?, is_active = 1, updated_at = ?
    `).run(
      `${req.user.id}-${platform}-${Date.now()}`,
      req.user.id,
      token,
      platform,
      deviceName,
      Date.now(),
      Date.now(),
      deviceName,
      Date.now()
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 获取通知模板
 */
router.get('/template/:type', (req, res) => {
  try {
    const { type } = req.params;
    const { language = 'zh-CN' } = req.query;
    
    const template = NotificationTemplate.getTemplate(type, language);
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * 入队通知
 */
router.post('/queue', authenticate, async (req, res) => {
  try {
    const { title, content, type, priority } = req.body;
    
    const result = await nq.enqueue(req.user.id, {
      title,
      content,
      type,
      priority,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
