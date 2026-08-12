/**
 * Web Vitals 性能监控
 * 监控 LCP、FID、CLS、FCP、TTFB 等核心指标
 */

let vitalsData = {
  lcp: null,
  fid: null,
  cls: null,
  fcp: null,
  ttfb: null,
};

// 上报至后端（可选）
function reportVital(metric) {
  vitalsData[metric.name.toLowerCase()] = metric.value;
  
  if (import.meta.env.DEV) {
    console.log(`[Web Vitals] ${metric.name}:`, metric.value.toFixed(2), 'ms');
  }
  
  // 生产环境上报
  if (import.meta.env.PROD && navigator.sendBeacon) {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
    navigator.sendBeacon('/api/metrics/vitals', body);
  }
}

// LCP - Largest Contentful Paint（最大内容绘制）
function observeLCP() {
  if (!('PerformanceObserver' in window)) return;
  
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      
      reportVital({
        name: 'LCP',
        value: lastEntry.renderTime || lastEntry.loadTime,
        rating: lastEntry.renderTime < 2500 ? 'good' : lastEntry.renderTime < 4000 ? 'needs-improvement' : 'poor',
        id: `lcp-${Date.now()}`,
      });
    });
    
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {
    console.warn('[Web Vitals] LCP observer failed:', e);
  }
}

// FID - First Input Delay（首次输入延迟）
function observeFID() {
  if (!('PerformanceObserver' in window)) return;
  
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        const delay = entry.processingStart - entry.startTime;
        reportVital({
          name: 'FID',
          value: delay,
          rating: delay < 100 ? 'good' : delay < 300 ? 'needs-improvement' : 'poor',
          id: `fid-${Date.now()}`,
        });
      });
    });
    
    observer.observe({ type: 'first-input', buffered: true });
  } catch (e) {
    console.warn('[Web Vitals] FID observer failed:', e);
  }
}

// CLS - Cumulative Layout Shift（累计布局偏移）
function observeCLS() {
  if (!('PerformanceObserver' in window)) return;
  
  let clsValue = 0;
  let sessionValue = 0;
  let sessionEntries = [];
  
  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        if (!entry.hadRecentInput) {
          const firstSessionEntry = sessionEntries[0];
          const lastSessionEntry = sessionEntries[sessionEntries.length - 1];
          
          if (sessionValue && entry.startTime - lastSessionEntry.startTime < 1000 && entry.startTime - firstSessionEntry.startTime < 5000) {
            sessionValue += entry.value;
            sessionEntries.push(entry);
          } else {
            sessionValue = entry.value;
            sessionEntries = [entry];
          }
          
          if (sessionValue > clsValue) {
            clsValue = sessionValue;
            reportVital({
              name: 'CLS',
              value: clsValue,
              rating: clsValue < 0.1 ? 'good' : clsValue < 0.25 ? 'needs-improvement' : 'poor',
              id: `cls-${Date.now()}`,
            });
          }
        }
      });
    });
    
    observer.observe({ type: 'layout-shift', buffered: true });
  } catch (e) {
    console.warn('[Web Vitals] CLS observer failed:', e);
  }
}

// FCP - First Contentful Paint（首次内容绘制）
function observeFCP() {
  if (!('PerformanceObserver' in window)) return;
  
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if (entry.name === 'first-contentful-paint') {
          reportVital({
            name: 'FCP',
            value: entry.startTime,
            rating: entry.startTime < 1800 ? 'good' : entry.startTime < 3000 ? 'needs-improvement' : 'poor',
            id: `fcp-${Date.now()}`,
          });
        }
      });
    });
    
    observer.observe({ type: 'paint', buffered: true });
  } catch (e) {
    console.warn('[Web Vitals] FCP observer failed:', e);
  }
}

// TTFB - Time to First Byte（首字节时间）
function observeTTFB() {
  if (!('PerformanceObserver' in window)) return;
  
  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        const ttfb = entry.responseStart - entry.requestStart;
        reportVital({
          name: 'TTFB',
          value: ttfb,
          rating: ttfb < 800 ? 'good' : ttfb < 1800 ? 'needs-improvement' : 'poor',
          id: `ttfb-${Date.now()}`,
        });
      });
    });
    
    observer.observe({ type: 'navigation', buffered: true });
  } catch (e) {
    console.warn('[Web Vitals] TTFB observer failed:', e);
  }
}

// 初始化所有监控
export function initWebVitals() {
  if (typeof window === 'undefined') return;
  
  // 延迟初始化，避免阻塞主线程
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      observeLCP();
      observeFID();
      observeCLS();
      observeFCP();
      observeTTFB();
    }, { timeout: 2000 });
  } else {
    setTimeout(() => {
      observeLCP();
      observeFID();
      observeCLS();
      observeFCP();
      observeTTFB();
    }, 1000);
  }
}

export function getVitalsData() {
  return vitalsData;
}
