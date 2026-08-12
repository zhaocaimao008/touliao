/**
 * 通知模板管理
 */

'use strict';

const { db } = require('../../db/connection');

class NotificationTemplate {
  /**
   * 获取模板
   */
  static getTemplate(type, language = 'zh-CN') {
    const templates = {
      'message_received': {
        'zh-CN': {
          title: '新消息',
          content: '你有来自 {senderName} 的新消息',
        },
        'en-US': {
          title: 'New Message',
          content: 'You have a new message from {senderName}',
        },
      },
      'friend_request': {
        'zh-CN': {
          title: '好友请求',
          content: '{userName} 请求加你为好友',
        },
        'en-US': {
          title: 'Friend Request',
          content: '{userName} sent you a friend request',
        },
      },
      'group_invite': {
        'zh-CN': {
          title: '群邀请',
          content: '{userName} 邀请你加入群组 {groupName}',
        },
        'en-US': {
          title: 'Group Invitation',
          content: '{userName} invited you to join {groupName}',
        },
      },
      'moment_like': {
        'zh-CN': {
          title: '点赞提醒',
          content: '{userName} 赞了你的朋友圈',
        },
        'en-US': {
          title: 'Like Notification',
          content: '{userName} liked your moment',
        },
      },
      'moment_comment': {
        'zh-CN': {
          title: '评论提醒',
          content: '{userName} 评论了你的朋友圈',
        },
        'en-US': {
          title: 'Comment Notification',
          content: '{userName} commented on your moment',
        },
      },
      'payment_received': {
        'zh-CN': {
          title: '收款通知',
          content: '你收到来自 {senderName} 的 ¥{amount} 转账',
        },
        'en-US': {
          title: 'Payment Received',
          content: 'You received ${amount} from {senderName}',
        },
      },
    };

    return templates[type]?.[language] || templates[type]?.['zh-CN'] || {};
  }

  /**
   * 渲染模板
   */
  static render(type, data, language = 'zh-CN') {
    const template = this.getTemplate(type, language);
    let title = template.title || '';
    let content = template.content || '';

    // 替换模板变量
    Object.entries(data).forEach(([key, value]) => {
      const regex = new RegExp(`{${key}}`, 'g');
      title = title.replace(regex, value);
      content = content.replace(regex, value);
    });

    return { title, content };
  }

  /**
   * 保存自定义模板
   */
  static saveCustomTemplate(name, templates) {
    db.prepare(`
      INSERT INTO notification_templates (name, templates, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET templates = ?, updated_at = ?
    `).run(name, JSON.stringify(templates), Date.now(), JSON.stringify(templates), Date.now());
  }

  /**
   * 获取自定义模板
   */
  static getCustomTemplate(name) {
    const row = db.prepare('SELECT templates FROM notification_templates WHERE name = ?').get(name);
    return row ? JSON.parse(row.templates) : null;
  }
}

module.exports = NotificationTemplate;
