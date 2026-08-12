'use strict';
/**
 * P4 优化特性测试 (P4.3-P4.7)
 */

const CacheWarmer = require('../src/utils/cacheWarmer');
const BatchAckManager = require('../src/utils/batchAckManager');
const SearchRanking = require('../src/utils/searchRanking');
const MessageDeduplicator = require('../src/utils/deduplicator');
const NetworkAwareRetry = require('../src/utils/networkAwareRetry');

describe('P4 优化特性测试', () => {
  
  describe('P4.3 搜索排序', () => {
    let ranking;

    beforeAll(() => {
      ranking = new SearchRanking();
    });

    test('应该计算相关性分数', () => {
      const message = {
        id: 'msg-1',
        content: 'hello world test',
        likes: 10,
        replies: 5,
      };

      const score = ranking.calcRelevanceScore(message, 'hello');
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('应该计算时间新鲜度分数', () => {
      const recentMsg = { created_at: Date.now() };
      const oldMsg = { created_at: Date.now() - 30 * 86400000 };

      const recentScore = ranking.calcRecencyScore(recentMsg);
      const oldScore = ranking.calcRecencyScore(oldMsg);

      expect(recentScore).toBeGreaterThan(oldScore);
    });

    test('应该计算热度分数', () => {
      const hotMsg = {
        likes: 100,
        replies: 50,
        forwards: 20,
        views: 1000,
      };
      const coldMsg = {
        likes: 0,
        replies: 0,
        forwards: 0,
        views: 10,
      };

      const hotScore = ranking.calcPopularityScore(hotMsg);
      const coldScore = ranking.calcPopularityScore(coldMsg);

      expect(hotScore).toBeGreaterThan(coldScore);
    });

    test('应该排序搜索结果', () => {
      const messages = [
        {
          id: 'm1',
          content: 'hello',
          created_at: Date.now() - 86400000,
          likes: 1,
          replies: 0,
          forwards: 0,
          views: 10,
        },
        {
          id: 'm2',
          content: 'hello world',
          created_at: Date.now(),
          likes: 10,
          replies: 5,
          forwards: 2,
          views: 100,
        },
      ];

      const ranked = ranking.rankResults(messages, 'hello');
      expect(ranked[0].id).toBe('m2'); // 应该是更新的和更热的
    });
  });

  describe('P4.5 批量 ACK', () => {
    let batchAck;

    beforeAll(() => {
      batchAck = new BatchAckManager();
    });

    test('应该添加 ACK 到待处理队列', async () => {
      const result = await batchAck.addToBatch('delivery', 'msg-1', 'user-1');
      expect(result.queued).toBe(true);
    });

    test('应该获取待处理统计', () => {
      const stats = batchAck.getStats();
      expect(stats.totalPending).toBeGreaterThanOrEqual(0);
    });

    test('应该处理批量 ACK', async () => {
      // 添加多个 ACK
      await batchAck.batchRecordDelivery('user-1', ['msg-1', 'msg-2', 'msg-3']);
      const stats = batchAck.getStats();
      expect(stats.totalPending).toBeGreaterThanOrEqual(0);
    });
  });

  describe('P4.4 消息去重', () => {
    let dedup;

    beforeAll(() => {
      dedup = new MessageDeduplicator();
    });

    test('应该检查消息重复', async () => {
      const isDup = await dedup.isDuplicate('user-1', 'client-msg-1');
      expect(typeof isDup).toBe('boolean');
    });

    test('应该标记消息已处理', async () => {
      await dedup.markProcessed('user-1', 'client-msg-1', { sent: true });
      const metadata = await dedup.getProcessedMetadata('user-1', 'client-msg-1');
      expect(metadata).toBeTruthy();
    });

    test('应该检测重复消息', async () => {
      await dedup.markProcessed('user-1', 'dup-msg-1');
      const isDup = await dedup.isDuplicate('user-1', 'dup-msg-1');
      expect(isDup).toBe(true);
    });

    test('应该获取去重统计', async () => {
      const stats = await dedup.getStats();
      expect(stats.totalDedup).toBeGreaterThanOrEqual(0);
      expect(typeof stats.byUser).toBe('object');
    });
  });

  describe('P4.6 缓存预热', () => {
    let warmer;

    beforeAll(() => {
      warmer = new CacheWarmer({
        maxActiveUsers: 10,
        maxHotMessages: 100,
      });
    });

    test('应该预热活跃用户', async () => {
      const result = await warmer.warmActiveUsers();
      expect(result.type).toBe('users');
      expect(result.cached).toBeGreaterThanOrEqual(0);
    });

    test('应该预热热消息', async () => {
      const result = await warmer.warmHotMessages();
      expect(result.type).toBe('messages');
      expect(result.cached).toBeGreaterThanOrEqual(0);
    });

    test('应该预热群组', async () => {
      const result = await warmer.warmGroups();
      expect(result.type).toBe('groups');
      expect(result.cached).toBeGreaterThanOrEqual(0);
    });
  });

  describe('P4.7 网络感知重试', () => {
    let networkAware;

    beforeAll(() => {
      networkAware = new NetworkAwareRetry();
    });

    test('应该检测网络质量', async () => {
      const quality = await networkAware.detectNetworkQuality();
      expect(['excellent', 'good', 'poor', 'offline']).toContain(quality);
    });

    test('应该计算重试延迟', () => {
      const delay1 = networkAware.calculateDelay(1);
      const delay2 = networkAware.calculateDelay(2);
      const delay3 = networkAware.calculateDelay(3);

      expect(delay1).toBeGreaterThanOrEqual(0);
      expect(delay2).toBeGreaterThan(0);
      expect(delay3).toBeGreaterThan(delay2);
    });

    test('应该返回重试配置', () => {
      const config = networkAware.getConfig();
      expect(config.currentQuality).toBeTruthy();
      expect(config.config).toBeTruthy();
      expect(config.allConfigs).toBeTruthy();
    });

    test('应该执行带重试的任务', async () => {
      let attempts = 0;
      const task = async () => {
        attempts++;
        if (attempts < 2) throw new Error('First attempt failed');
        return 'success';
      };

      const result = await networkAware.executeWithRetry(task);
      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    test('应该设置网络质量', () => {
      networkAware.setNetworkQuality('poor');
      const config = networkAware.getConfig();
      expect(config.currentQuality).toBe('poor');
    });
  });
});
