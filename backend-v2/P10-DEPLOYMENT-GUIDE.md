# P10 安全性能加固 - 部署指南

## 快速开始

### 1. 模块安装

```bash
cd /root/v信/backend-v2
npm install clinic.js speakeasy # P10 依赖
```

### 2. 核心模块集成

在 `server.js` 中添加：

```javascript
// P10 模块初始化
const P10Modules = {
  sqlDefense: new (require('./src/utils/optimization-p10/sqlInjectionDefense'))(),
  memoryDetector: new (require('./src/utils/optimization-p10/memoryLeakDetector'))(),
  errorHandler: new (require('./src/utils/optimization-p10/errorHandlingGlobal'))(),
  logger: new (require('./src/utils/optimization-p10/structuredLogging'))(),
  queryOptimizer: new (require('./src/utils/optimization-p10/queryOptimizationEngine'))(db),
  rateLimiter: new (require('./src/utils/optimization-p10/rateLimitingAdvanced'))(redis),
  raceAnalyzer: new (require('./src/utils/optimization-p10/raceConditionAnalyzer'))(db),
  backup: new (require('./src/utils/optimization-p10/backupRecoveryAutomation'))(db),
};

// 启动全局错误处理
P10Modules.errorHandler.setupGlobalHandlers();

// 启动内存监控
P10Modules.memoryDetector.takeSnapshot('startup');

// 启动自动备份
P10Modules.backup.startAutoBackup();
```

### 3. 中间件集成

```javascript
// 限流中间件
app.use(async (req, res, next) => {
  const result = await P10Modules.rateLimiter.multiDimensionalLimit(
    req.userId,
    req.ip,
    req.path
  );
  
  if (!result.allowed) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  next();
});

// 日志中间件
app.use((req, res, next) => {
  P10Modules.logger.info('request_started', {
    method: req.method,
    path: req.path,
    userId: req.userId,
  });
  next();
});
```

## 性能验证

### 查询优化

```javascript
// 分析查询计划
const plan = await P10Modules.queryOptimizer.analyzeExecutionPlan(sql);

// 获取性能报告
const report = P10Modules.queryOptimizer.getPerformanceReport();
console.log('N+1 Patterns:', report.nPlusOnePatterns);
```

### 压力测试

```javascript
const LoadTest = require('./src/utils/optimization-p10/loadTestingFramework');
const tester = new LoadTest();

const result = await tester.loadTest(
  async () => { /* 你的API调用 */ },
  { rps: 100, duration: 60000 }
);

console.log(result); // 查看测试结果
```

## 监控指标

### 内存泄漏检测

```javascript
// 每小时检查一次
setInterval(() => {
  const report = P10Modules.memoryDetector.getDiagnosticReport();
  if (report.leakAnalysis.leakDetected) {
    console.warn('⚠️ 可能的内存泄漏:', report);
  }
}, 3600000);
```

### 日志聚合

```javascript
// 每小时生成日志报告
setInterval(() => {
  const summary = P10Modules.logger.aggregateLogs(1);
  console.log('日志汇总:', summary);
}, 3600000);
```

## 故障排查

### 问题：高内存使用

```javascript
const diagnostic = P10Modules.memoryDetector.getDiagnosticReport();
console.log('未清理计时器:', diagnostic.uncleanedTimers);
console.log('事件监听器警告:', diagnostic.eventListenerWarnings);
```

### 问题：频繁告警

```javascript
const errors = P10Modules.errorHandler.getErrorReport(1);
console.log('1小时内错误统计:', errors);
```

## 升级路径

P10 -> P11: 全球化 + CDN + 多区域部署
P11 -> P12: AI 功能 + 高级分析

