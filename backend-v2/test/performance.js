import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// 自定义指标
const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');
const cacheMissCount = new Counter('cache_misses');
const cacheHitCount = new Counter('cache_hits');
const concurrentUsers = new Gauge('concurrent_users');

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // 快速升温到 10 并发
    { duration: '2m', target: 50 },    // 逐步升到 50 并发
    { duration: '2m', target: 100 },   // 继续升到 100 并发
    { duration: '2m', target: 50 },    // 降到 50 并发
    { duration: '30s', target: 0 },    // 冷却
  ],
  thresholds: {
    errors: ['rate<0.1'],              // 错误率 < 10%
    response_time: ['p(95)<2000'],     // P95 响应时间 < 2s
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3002';
let authToken = '';
let userId = '';
let conversationId = '';

export function setup() {
  // 注册测试用户
  // k6 cannot import the CommonJS policy source. The operator must review and
  // explicitly supply the current policy version for synthetic load-test users.
  if (!__ENV.LEGAL_CONSENT_VERSION) throw new Error('BLOCKED: LEGAL_CONSENT_VERSION is required');
  const registerPayload = JSON.stringify({
    legalConsent: { accepted: true, privacyVersion: __ENV.LEGAL_CONSENT_VERSION, termsVersion: __ENV.LEGAL_CONSENT_VERSION },
    phone: `138${Math.random().toString().slice(2, 11)}`,
    password: 'Test@12345',
    username: '压力测试用户',
  });

  const registerRes = http.post(`${BASE_URL}/api/auth/register`, registerPayload, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (registerRes.status === 200 || registerRes.status === 201) {
    const userData = JSON.parse(registerRes.body);
    userId = userData.user.id;
    authToken = userData.user.token;
  }

  // 创建会话
  const convPayload = JSON.stringify({
    participantId: 'test-user-2',
  });

  const convRes = http.post(`${BASE_URL}/api/messages/conversation/private`, convPayload, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
  });

  if (convRes.status === 200 || convRes.status === 201) {
    const convData = JSON.parse(convRes.body);
    conversationId = convData.conversation.id;
  }

  return { authToken, userId, conversationId };
}

export default function (data) {
  concurrentUsers.set(__VU);
  const token = data.authToken;
  const convId = data.conversationId;

  // 场景 1: 列表对话（测试缓存）
  {
    const res = http.get(`${BASE_URL}/api/messages/conversations`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    check(res, {
      'conversations 200': (r) => r.status === 200,
      'conversations body valid': (r) => r.body.length > 0,
      'conversations response time < 500ms': (r) => r.timings.duration < 500,
    });

    responseTime.add(res.timings.duration);
    if (res.status !== 200) {
      errorRate.add(1);
    }

    sleep(Math.random() * 2); // 0-2秒随机等待
  }

  // 场景 2: 获取消息历史（测试缓存命中）
  {
    const res = http.get(
      `${BASE_URL}/api/messages/${convId}?offset=0&limit=20`,
      {
        headers: { 'Authorization': `Bearer ${token}` },
      }
    );

    check(res, {
      'message history 200': (r) => r.status === 200,
      'message history response time < 1000ms': (r) => r.timings.duration < 1000,
    });

    responseTime.add(res.timings.duration);
    if (res.status !== 200) {
      errorRate.add(1);
    } else {
      cacheHitCount.add(1);
    }

    sleep(Math.random() * 2);
  }

  // 场景 3: 全局搜索消息
  {
    const res = http.get(`${BASE_URL}/api/messages/search?q=测试`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    check(res, {
      'search 200': (r) => r.status === 200,
      'search response time < 1500ms': (r) => r.timings.duration < 1500,
    });

    responseTime.add(res.timings.duration);
    if (res.status !== 200) {
      errorRate.add(1);
    } else {
      cacheMissCount.add(1);
    }

    sleep(Math.random() * 2);
  }

  // 场景 4: 发送消息（写操作）
  {
    const msgPayload = JSON.stringify({
      content: `压力测试消息 ${new Date().getTime()}`,
      type: 'text',
    });

    const res = http.post(
      `${BASE_URL}/api/messages/${convId}`,
      msgPayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      }
    );

    check(res, {
      'send message 200': (r) => r.status === 200 || r.status === 201,
      'send message response time < 2000ms': (r) => r.timings.duration < 2000,
    });

    responseTime.add(res.timings.duration);
    if (res.status !== 200 && res.status !== 201) {
      errorRate.add(1);
    }

    sleep(Math.random() * 3);
  }

  // 场景 5: 获取用户详情（测试缓存）
  {
    const res = http.get(`${BASE_URL}/api/users/${data.userId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    check(res, {
      'user detail 200': (r) => r.status === 200,
      'user detail response time < 500ms': (r) => r.timings.duration < 500,
    });

    responseTime.add(res.timings.duration);
    if (res.status !== 200) {
      errorRate.add(1);
    } else {
      cacheHitCount.add(1);
    }

    sleep(Math.random() * 2);
  }

  // 场景 6: 获取指标端点
  {
    const res = http.get(`${BASE_URL}/metrics`);

    check(res, {
      'metrics 200': (r) => r.status === 200,
      'metrics response time < 100ms': (r) => r.timings.duration < 100,
    });

    responseTime.add(res.timings.duration);
  }
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'performance-results.json': JSON.stringify(data),
  };
}

// 简化的文本摘要
function textSummary(data, options = {}) {
  let summary = '\n=== Performance Test Results ===\n';

  const metrics = data.metrics;
  if (metrics) {
    if (metrics.errors) {
      summary += `Error Rate: ${(metrics.errors.values.rate * 100).toFixed(2)}%\n`;
    }
    if (metrics.response_time) {
      const trend = metrics.response_time.values;
      summary += `Response Time - Avg: ${Math.round(trend.avg)}ms, P95: ${Math.round(trend['p(95)'])}ms, P99: ${Math.round(trend['p(99)'])}ms\n`;
    }
    if (metrics.cache_hits) {
      summary += `Cache Hits: ${metrics.cache_hits.values.count}\n`;
    }
    if (metrics.cache_misses) {
      summary += `Cache Misses: ${metrics.cache_misses.values.count}\n`;
    }
  }

  return summary;
}
