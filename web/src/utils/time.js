export function format(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  const today = new Date(); today.setHours(0,0,0,0);
  if (d >= today) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= yesterday) return '昨天';
  const thisYear = new Date(today); thisYear.setMonth(0, 1);
  if (d >= thisYear) return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function formatFull(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (d >= today) return time;
  if (d >= yesterday) return '昨天 ' + time;
  const thisYear = new Date(); thisYear.setMonth(0,1); thisYear.setHours(0,0,0,0);
  if (d >= thisYear) return `${d.getMonth()+1}月${d.getDate()}日 ${time}`;
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${time}`;
}

/**
 * 格式化最后在线时间（特权账户专用），精确到分钟。
 * @param {number} ts  Unix 秒（服务端返回），0 或 null 表示从未上线
 * @param {boolean} isOnline 当前是否在线（来自 socket 状态）
 */
export function formatLastOnline(ts, isOnline) {
  if (isOnline) return '当前在线';
  if (!ts || ts <= 0) return null;
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  const diff = Math.max(0, now - d.getTime());
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (diff < 60000) return '刚刚在线';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前在线`;
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= today)     return `今天 ${time}`;
  if (d >= yesterday) return `昨天 ${time}`;
  const thisYear = new Date(); thisYear.setMonth(0,1); thisYear.setHours(0,0,0,0);
  if (d >= thisYear) return `${d.getMonth()+1}月${d.getDate()}日 ${time}`;
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()} ${time}`;
}
