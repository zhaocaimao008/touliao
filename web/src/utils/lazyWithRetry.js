import { lazy } from 'react';

// React.lazy 会缓存失败的 import：断网时切到某页面导致分包下载失败后，恢复网络也一直报错，
// 只能整页刷新。这里在失败时重试：离线则等 online 事件，否则逐次退避，最多重试 retries 次。
export async function importWithRetry(factory, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await factory();
    } catch (error) {
      if (attempt >= retries) throw error;
      if (typeof navigator !== 'undefined' && navigator.onLine === false && typeof window !== 'undefined') {
        await new Promise(resolve => window.addEventListener('online', resolve, { once: true }));
      } else {
        await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }
}

export function lazyWithRetry(factory, retries = 3) {
  return lazy(() => importWithRetry(factory, retries));
}
