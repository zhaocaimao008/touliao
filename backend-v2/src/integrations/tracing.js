/**
 * 分布式追踪集成（OpenTelemetry）
 * 提供完整的请求链路追踪能力
 */

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const opentelemetry = require('@opentelemetry/api');

class DistributedTracing {
  constructor() {
    this.sdk = null;
    this.tracer = null;
    this.isEnabled = false;
    this.spans = new Map();
  }

  /**
   * 初始化追踪系统
   */
  async initialize(config = {}) {
    const serviceName = config.serviceName || process.env.SERVICE_NAME || 'vxin-backend';
    const exporterEndpoint = config.exporterEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
    const enabled = config.enabled !== false && process.env.TRACING_ENABLED !== 'false';

    if (!enabled) {
      console.log('[Tracing] Disabled by configuration');
      return this;
    }

    try {
      // 配置资源
      const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '2.1.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      });

      // 配置导出器
      const traceExporter = new OTLPTraceExporter({
        url: exporterEndpoint,
        headers: {},
      });

      // 初始化 SDK
      this.sdk = new NodeSDK({
        resource,
        traceExporter,
        instrumentations: [
          getNodeAutoInstrumentations({
            '@opentelemetry/instrumentation-fs': {
              enabled: false, // 文件系统追踪可能过于详细
            },
          }),
        ],
      });

      await this.sdk.start();
      
      this.tracer = opentelemetry.trace.getTracer(serviceName);
      this.isEnabled = true;

      console.log(`[Tracing] Initialized - Service: ${serviceName}, Exporter: ${exporterEndpoint}`);
    } catch (error) {
      console.error('[Tracing] Failed to initialize:', error.message);
      console.log('[Tracing] Falling back to in-memory tracing');
      this.isEnabled = false;
    }

    return this;
  }

  /**
   * 开始一个新的 Span
   */
  startSpan(name, attributes = {}) {
    if (!this.isEnabled || !this.tracer) {
      // 降级：使用简单的内存追踪
      const spanId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.spans.set(spanId, {
        name,
        attributes,
        startTime: Date.now(),
      });
      return {
        spanId,
        setAttribute: () => {},
        setStatus: () => {},
        end: () => {
          const span = this.spans.get(spanId);
          if (span) {
            span.endTime = Date.now();
            span.duration = span.endTime - span.startTime;
          }
        },
      };
    }

    const span = this.tracer.startSpan(name, {
      attributes,
    });

    return span;
  }

  /**
   * 追踪异步函数
   */
  async traceAsync(name, fn, attributes = {}) {
    const span = this.startSpan(name, attributes);

    try {
      const result = await fn(span);
      span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: opentelemetry.SpanStatusCode.ERROR,
        message: error.message,
      });
      span.setAttribute('error', true);
      span.setAttribute('error.message', error.message);
      span.setAttribute('error.stack', error.stack);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * 追踪同步函数
   */
  traceSync(name, fn, attributes = {}) {
    const span = this.startSpan(name, attributes);

    try {
      const result = fn(span);
      span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: opentelemetry.SpanStatusCode.ERROR,
        message: error.message,
      });
      span.setAttribute('error', true);
      span.setAttribute('error.message', error.message);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Express 中间件 - 自动追踪 HTTP 请求
   */
  middleware() {
    return (req, res, next) => {
      const span = this.startSpan(`HTTP ${req.method} ${req.path}`, {
        'http.method': req.method,
        'http.url': req.url,
        'http.target': req.path,
        'http.host': req.get('host'),
        'http.user_agent': req.get('user-agent'),
        'user.id': req.user?.id,
      });

      // 记录响应
      const originalSend = res.send;
      res.send = function (data) {
        span.setAttribute('http.status_code', res.statusCode);
        span.setAttribute('http.response_content_length', data ? data.length : 0);
        
        if (res.statusCode >= 400) {
          span.setStatus({
            code: opentelemetry.SpanStatusCode.ERROR,
            message: `HTTP ${res.statusCode}`,
          });
        } else {
          span.setStatus({ code: opentelemetry.SpanStatusCode.OK });
        }
        
        span.end();
        return originalSend.call(this, data);
      };

      // 记录错误
      res.on('finish', () => {
        if (!span.ended) {
          span.setAttribute('http.status_code', res.statusCode);
          if (res.statusCode >= 400) {
            span.setStatus({
              code: opentelemetry.SpanStatusCode.ERROR,
              message: `HTTP ${res.statusCode}`,
            });
          }
          span.end();
        }
      });

      next();
    };
  }

  /**
   * 获取内存追踪统计
   */
  getInMemoryStats() {
    const spans = Array.from(this.spans.values());
    const completed = spans.filter(s => s.endTime);
    
    return {
      total: spans.length,
      completed: completed.length,
      pending: spans.length - completed.length,
      avgDuration: completed.length > 0
        ? (completed.reduce((sum, s) => sum + s.duration, 0) / completed.length).toFixed(2)
        : 0,
      spans: completed.slice(-20).map(s => ({
        name: s.name,
        duration: s.duration,
        attributes: s.attributes,
      })),
    };
  }

  /**
   * 清理内存追踪
   */
  clearInMemorySpans() {
    const now = Date.now();
    for (const [id, span] of this.spans.entries()) {
      // 删除超过 5 分钟的 span
      if (span.endTime && now - span.endTime > 300000) {
        this.spans.delete(id);
      }
    }
  }

  /**
   * 关闭追踪系统
   */
  async shutdown() {
    if (this.sdk) {
      await this.sdk.shutdown();
      console.log('[Tracing] Shutdown complete');
    }
    this.spans.clear();
  }
}

// 单例实例
const tracing = new DistributedTracing();

// 定期清理内存追踪
setInterval(() => {
  tracing.clearInMemorySpans();
}, 60000);

module.exports = {
  tracing,
  DistributedTracing,
};
