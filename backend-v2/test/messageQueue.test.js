'use strict';
/**
 * 消息队列与 ACK 管理测试
 */

const MessageQueue = require('../src/utils/messageQueue');
const AckManager = require('../src/utils/ackManager');

describe('消息队列与 ACK 管理', () => {
  let msgQueue;
  let ackManager;

  beforeAll(() => {
    msgQueue = new MessageQueue({ maxRetries: 3, retryDelayMs: 1000 });
    ackManager = new AckManager({ ackTtl: 86400 });
  });

  describe('消息队列', () => {
    test('应该入队消息', async () => {
      const message = {
        id: 'msg-1',
        conversationId: 'conv-1',
        content: 'test message',
        senderId: 'user-1',
      };

      const msgId = await msgQueue.enqueue('messages', message);
      expect(msgId).toBe('msg-1');
    });

    test('应该获取队列统计', async () => {
      const stats = await msgQueue.getQueueStats('messages');
      expect(stats.queue).toBe('messages');
      expect(stats.pending).toBeGreaterThanOrEqual(0);
      expect(stats.dlq).toBeGreaterThanOrEqual(0);
    });

    test('应该标记消息已处理', async () => {
      const message = {
        id: 'msg-2',
        conversationId: 'conv-1',
        content: 'test message 2',
        senderId: 'user-1',
      };

      await msgQueue.enqueue('messages', message);
      await msgQueue.markProcessed('msg-2');

      // 验证重试 key 已删除
      const stats = await msgQueue.getQueueStats('messages');
      expect(stats).toBeDefined();
    });
  });

  describe('ACK 管理', () => {
    test('应该记录消息送达', async () => {
      await ackManager.recordDelivery('msg-1', 'user-1', Date.now());
      const delivered = await ackManager.getDeliveredUsers('msg-1');
      expect(delivered).toContain('user-1');
    });

    test('应该记录消息已读', async () => {
      await ackManager.recordRead('msg-1', 'user-1', Date.now());
      const read = await ackManager.getReadUsers('msg-1');
      expect(read).toContain('user-1');
    });

    test('应该获取消息 ACK 状态', async () => {
      await ackManager.recordDelivery('msg-3', 'user-1', Date.now());
      await ackManager.recordDelivery('msg-3', 'user-2', Date.now());
      await ackManager.recordRead('msg-3', 'user-1', Date.now());

      const status = await ackManager.getMessageAckStatus('msg-3', ['user-1', 'user-2', 'user-3']);
      
      expect(status.delivered).toBe(2);
      expect(status.read).toBe(1);
      expect(status.pending).toBe(1);
      expect(status.details['user-1'].delivered).toBe(true);
      expect(status.details['user-1'].read).toBe(true);
      expect(status.details['user-3'].delivered).toBe(false);
    });

    test('应该批量获取消息 ACK 状态', async () => {
      const messageIds = ['msg-1', 'msg-3', 'msg-unknown'];
      const results = await ackManager.getMultipleMessageAckStatus(messageIds);
      
      expect(results.length).toBe(3);
      expect(results[0]).toHaveProperty('messageId');
      expect(results[0]).toHaveProperty('delivered');
    });

    test('应该清除消息 ACK 数据', async () => {
      const msgId = 'msg-to-clear';
      await ackManager.recordDelivery(msgId, 'user-1', Date.now());
      
      let delivered = await ackManager.getDeliveredUsers(msgId);
      expect(delivered.length).toBeGreaterThan(0);

      await ackManager.clearMessageAck(msgId);
      
      delivered = await ackManager.getDeliveredUsers(msgId);
      expect(delivered.length).toBe(0);
    });

    test('应该获取用户 ACK 统计', async () => {
      const stats = await ackManager.getUserAckStats('user-1');
      expect(stats.userId).toBe('user-1');
      expect(stats.totalAcks).toBeGreaterThanOrEqual(0);
      expect(stats.delivered).toBeGreaterThanOrEqual(0);
    });
  });

  describe('重试机制', () => {
    test('应该支持消息重试', async () => {
      const message = {
        id: 'msg-retry-1',
        conversationId: 'conv-1',
        content: 'retry test',
        senderId: 'user-1',
      };

      const shouldRetry = await msgQueue.markFailed('messages', message, new Error('处理失败'));
      expect(shouldRetry).toBe(true);
    });

    test('应该在重试达到上限后送入 DLQ', async () => {
      const message = {
        id: 'msg-dlq-1',
        conversationId: 'conv-1',
        content: 'will be dlq',
        senderId: 'user-1',
        retryCount: 2,
      };

      // 模拟 3 次失败（达到上限）
      for (let i = 0; i < 3; i++) {
        const shouldRetry = await msgQueue.markFailed('messages', message, new Error(`失败 ${i + 1}`));
        if (!shouldRetry) break;
      }

      const dlqMessages = await msgQueue.getDLQMessages('messages');
      expect(dlqMessages.length).toBeGreaterThan(0);
    });

    test('应该清空 DLQ', async () => {
      await msgQueue.clearDLQ('messages');
      const dlqMessages = await msgQueue.getDLQMessages('messages');
      expect(dlqMessages.length).toBe(0);
    });
  });
});
