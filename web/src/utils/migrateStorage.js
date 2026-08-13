/**
 * migrateStorage — localStorage key 迁移
 * 把 vxin_* 旧 key 迁移到 touliao_* 新 key（老用户数据无缝保留）
 * 只在 key 不存在时迁移，避免覆盖新数据
 */
const MIGRATIONS = [
  ['touliao_server_url',          'touliao_server_url'],
  ['touliao_electron_token',      'touliao_electron_token'],
  ['touliao_accounts_v2',         'touliao_accounts_v2'],
  ['touliao_creds_v1', 'touliao_creds_v1'],
  ['touliao_error_log',           'touliao_error_log'],
  ['touliao_csrf_cache',         'touliao_csrf_cache'],
];

export function migrateStorage() {
  try {
    for (const [oldKey, newKey] of MIGRATIONS) {
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal !== null && localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, oldVal);
      }
      // 旧 key 保留一段时间，不立即删除（防止回滚）
    }
  } catch { /* localStorage 在隐私模式下不可用 */ }
}
