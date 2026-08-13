/**
 * 网络请求优化：防抖、节流、请求合并、智能重试
 */

// 防抖函数（增强版）
export function debounce(fn, delay = 300, options = {}) {
  let timer = null;
  let lastArgs = null;
  const { leading = false, trailing = true, maxWait } = options;
  let lastCallTime = 0;
  let lastInvokeTime = 0;

  function invokeFunc(time) {
    const args = lastArgs;
    lastArgs = null;
    lastInvokeTime = time;
    return fn.apply(this, args);
  }

  return function debounced(...args) {
    const time = Date.now();
    const _timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;

    lastCallTime = time;
    lastArgs = args;

    // 首次调用 + leading 模式：立即执行
    if (leading && timeSinceLastInvoke >= delay) {
      return invokeFunc(time);
    }

    // maxWait 限制：即使持续调用，也要在 maxWait 后执行
    if (maxWait && timeSinceLastInvoke >= maxWait) {
      if (timer) clearTimeout(timer);
      return invokeFunc(time);
    }

    // 清除旧定时器
    if (timer) clearTimeout(timer);

    // trailing 模式：延迟执行
    if (trailing) {
      timer = setTimeout(() => {
        timer = null;
        invokeFunc(Date.now());
      }, delay);
    }
  };
}

// 节流函数（增强版）
export function throttle(fn, delay = 300, options = {}) {
  let timer = null;
  let lastRun = 0;
  const { leading = true, trailing = true } = options;

  return function throttled(...args) {
    const now = Date.now();
    const timeSinceLastRun = now - lastRun;

    // 首次执行或间隔足够
    if (leading && (!lastRun || timeSinceLastRun >= delay)) {
      lastRun = now;
      return fn.apply(this, args);
    }

    // trailing 模式：确保最后一次调用会执行
    if (trailing) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        lastRun = Date.now();
        timer = null;
        fn.apply(this, args);
      }, delay - timeSinceLastRun);
    }
  };
}

// 请求去重：相同 key 的并发请求只执行一次
const pendingRequests = new Map();

export function dedupeRequest(key, requestFn) {
  if (pendingRequests.has(key)) {
    return pendingRequests.get(key);
  }

  const promise = requestFn()
    .finally(() => {
      pendingRequests.delete(key);
    });

  pendingRequests.set(key, promise);
  return promise;
}

// 批量请求合并（DataLoader 模式）
export class BatchRequestLoader {
  constructor(batchFn, options = {}) {
    this.batchFn = batchFn;
    this.maxBatchSize = options.maxBatchSize || 50;
    this.batchWindowMs = options.batchWindowMs || 10;
    this.queue = [];
    this.timer = null;
  }

  load(key) {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });

      // 达到批量上限，立即执行
      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
        return;
      }

      // 否则等待批量窗口
      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.batchWindowMs);
      }
    });
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    const keys = batch.map(item => item.key);

    this.batchFn(keys)
      .then(results => {
        batch.forEach((item, index) => {
          item.resolve(results[index]);
        });
      })
      .catch(error => {
        batch.forEach(item => {
          item.reject(error);
        });
      });
  }
}

// 智能重试（指数退避 + 抖动）
export async function retryRequest(requestFn, options = {}) {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    jitter = true,
    shouldRetry = (error) => {
      // 默认：网络错误、5xx 错误重试
      if (!error.response) return true;
      const status = error.response.status;
      return status >= 500 && status < 600;
    },
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestFn();
    } catch (error) {
      lastError = error;

      // 最后一次尝试失败，直接抛出
      if (attempt === maxRetries) {
        throw error;
      }

      // 不应重试的错误，直接抛出
      if (!shouldRetry(error)) {
        throw error;
      }

      // 计算退避延迟
      let delay = Math.min(initialDelay * Math.pow(backoffFactor, attempt), maxDelay);

      // 添加抖动（避免雷击效应）
      if (jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// 请求队列（限制并发数）
export class RequestQueue {
  constructor(concurrency = 6) {
    this.concurrency = concurrency;
    this.running = 0;
    this.queue = [];
  }

  async add(requestFn) {
    if (this.running >= this.concurrency) {
      await new Promise(resolve => this.queue.push(resolve));
    }

    this.running++;
    try {
      return await requestFn();
    } finally {
      this.running--;
      const resolve = this.queue.shift();
      if (resolve) resolve();
    }
  }

  clear() {
    this.queue.forEach(resolve => resolve());
    this.queue = [];
  }
}

// 全局请求队列实例
export const globalRequestQueue = new RequestQueue(6);

// 请求缓存（带 TTL）
export class RequestCache {
  constructor(ttl = 5000) {
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    // 检查过期
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  set(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });

    // 自动清理过期项（避免内存泄漏）
    if (this.cache.size > 100) {
      this.cleanup();
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  clear() {
    this.cache.clear();
  }
}

// 带缓存的请求包装器
export function cachedRequest(key, requestFn, cache, _ttl) {
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  return requestFn().then(result => {
    cache.set(key, result);
    return result;
  });
}
