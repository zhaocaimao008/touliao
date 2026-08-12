/**
 * P10.2: 全局错误处理 + 自动恢复
 */

class GlobalErrorHandler {
  constructor() {
    this.errorLog = [];
    this.recoveryStrategies = new Map();
    this.maxRetries = 3;
  }

  /**
   * 注册错误恢复策略
   */
  registerRecoveryStrategy(errorType, strategy) {
    this.recoveryStrategies.set(errorType, strategy);
  }

  /**
   * 处理异步错误
   */
  async handleError(error, context = {}) {
    const errorEntry = {
      message: error.message,
      stack: error.stack,
      type: error.constructor.name,
      timestamp: Date.now(),
      context,
      recovered: false,
    };
    
    this.errorLog.push(errorEntry);
    
    // 尝试恢复
    const strategy = this.recoveryStrategies.get(error.constructor.name);
    if (strategy) {
      try {
        await strategy(error, context);
        errorEntry.recovered = true;
        return { recovered: true };
      } catch (e) {
        return { recovered: false, recoveryError: e.message };
      }
    }
    
    return { recovered: false };
  }

  /**
   * 全局异常处理
   */
  setupGlobalHandlers() {
    // 未捕获的 Promise rejection
    process.on('unhandledRejection', (reason, promise) => {
      this.handleError(new Error(`Promise rejection: ${reason}`), {
        type: 'unhandledRejection',
      });
    });
    
    // 未捕获的同步异常
    process.on('uncaughtException', (error) => {
      this.handleError(error, {
        type: 'uncaughtException',
      });
    });
  }

  /**
   * 获取错误报告
   */
  getErrorReport(hours = 1) {
    const cutoff = Date.now() - hours * 3600 * 1000;
    const recent = this.errorLog.filter(e => e.timestamp > cutoff);
    
    return {
      totalErrors: recent.length,
      recoveredCount: recent.filter(e => e.recovered).length,
      recoveryRate: recent.length > 0 
        ? (recent.filter(e => e.recovered).length / recent.length * 100).toFixed(2) + '%'
        : '0%',
      topErrors: [...new Set(recent.map(e => e.type))],
    };
  }
}

module.exports = GlobalErrorHandler;
