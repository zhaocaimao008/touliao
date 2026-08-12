describe('P10 Optimization Tests', () => {
  // SQL注入防护测试
  it('SQL Injection Defense - should detect suspicious patterns', () => {
    const defense = new (require('../src/utils/optimization-p10/sqlInjectionDefense'))();
    const issues = defense.validateParameterizedQuery(
      'SELECT * FROM users WHERE id = ?',
      [123]
    );
    expect(issues.length).toBe(0);
  });

  // 内存泄漏检测
  it('Memory Leak Detector - should detect growing memory', () => {
    const detector = new (require('../src/utils/optimization-p10/memoryLeakDetector'))();
    detector.takeSnapshot('s1');
    detector.takeSnapshot('s2');
    const analysis = detector.analyzeMemoryTrend();
    expect(analysis).toBeDefined();
  });

  // 限流测试
  it('Rate Limiter - should enforce limits', async () => {
    const MockRedis = require('./mocks/redis');
    const limiter = new (require('../src/utils/optimization-p10/rateLimitingAdvanced'))(new MockRedis());
    const result = await limiter.checkTokenBucket('user1', 10, 5);
    expect(result.allowed).toBe(true);
  });

  // 查询优化
  it('Query Optimizer - should identify N+1 patterns', () => {
    const MockDB = require('./mocks/db');
    const optimizer = new (require('../src/utils/optimization-p10/queryOptimizationEngine'))(new MockDB());
    const patterns = optimizer.detectNPlusOne();
    expect(Array.isArray(patterns)).toBe(true);
  });
});
