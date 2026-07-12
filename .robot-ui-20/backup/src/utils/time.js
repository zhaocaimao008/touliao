export function format(ts) {
  const d = new Date(ts);
  // 无效时间戳(undefined/null/坏字符串)会让 toLocaleTimeString 渲染成「Invalid Date」,直接返回空串
  if (Number.isNaN(d.getTime())) return '';
  // 时钟偏差/服务器时间超前时 diff 可能为负,钳到 0 避免出现「-3分钟前」
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
