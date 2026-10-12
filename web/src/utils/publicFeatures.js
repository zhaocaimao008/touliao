// 公共配置 /api/config 中的 features 能力开关（由 Home 拉取/socket config:updated 时写入）。
// 只有显式 === false 才视为关闭；features 缺失（旧后端）时一律保持原有行为。
let features = null;
let waiters = [];

export function setPublicFeatures(f) {
  if (!f || typeof f !== 'object') return;
  features = { ...f };
  const pending = waiters;
  waiters = [];
  pending.forEach(resolve => resolve(features));
}

export function getPublicFeatures() { return features; }

/** 能力被后端显式关闭（=== false）时返回 true；未知/缺失返回 false。 */
export function isFeatureDisabled(name) { return features?.[name] === false; }

/**
 * 等待首份 features 到位（最多 timeoutMs），超时返回 null（按旧行为处理）。
 */
export function waitForPublicFeatures(timeoutMs = 3000) {
  if (features) return Promise.resolve(features);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      waiters = waiters.filter(w => w !== done);
      resolve(null);
    }, timeoutMs);
    const done = f => { clearTimeout(timer); resolve(f); };
    waiters.push(done);
  });
}

/** 测试用 */
export function __resetPublicFeatures() { features = null; waiters = []; }
