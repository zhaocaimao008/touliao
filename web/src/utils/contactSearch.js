export const normalizeContactQuery = query => String(query ?? '').trim().toLowerCase();

export function matchesContact(contact, query) {
  const q = normalizeContactQuery(query);
  return !q || ['remark', 'username', 'wechat_id', 'phone'].some(field =>
    String(contact?.[field] ?? '').toLowerCase().includes(q));
}
