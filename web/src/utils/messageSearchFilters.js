export const MESSAGE_SEARCH_TYPES = [
  { value: '', labelKey: 'gs.allTypes', icon: '○' },
  { value: 'text', labelKey: 'gs.typeText', icon: '文' },
  { value: 'image', labelKey: 'gs.typeImage', icon: '▧' },
  { value: 'voice', labelKey: 'gs.typeVoice', icon: '◖' },
  { value: 'video', labelKey: 'gs.typeVideo', icon: '▶' },
  { value: 'file', labelKey: 'gs.typeFile', icon: '▤' },
  { value: 'contact_card', labelKey: 'gs.typeContactCard', icon: '人' },
  { value: 'red_packet', labelKey: 'gs.typeRedPacket', icon: '包' },
  { value: 'transfer', labelKey: 'gs.typeTransfer', icon: '¥' },
  { value: 'merged', labelKey: 'gs.typeMerged', icon: '☷' },
  { value: 'call', labelKey: 'gs.typeCall', icon: '☎' },
];

const TYPE_BY_VALUE = new Map(MESSAGE_SEARCH_TYPES.map(option => [option.value, option]));

export function buildMessageSearchParams({ query = '', type = '', timeRange = '', senderId = '' }, now = new Date()) {
  const params = { q: query, limit: 20 };
  if (type) params.type = type;
  if (timeRange) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    if (timeRange === '7d') start.setDate(start.getDate() - 7);
    if (timeRange === '30d') start.setDate(start.getDate() - 30);
    params.from = Math.floor(start.getTime() / 1000);
    params.to = Math.floor(now.getTime() / 1000);
  }
  if (senderId) params.senderId = senderId;
  return params;
}

function parseObject(content) {
  if (!content || typeof content !== 'string') return {};
  try {
    const value = JSON.parse(content);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function compact(label, detail = '') {
  const safeDetail = String(detail || '').trim();
  return safeDetail ? `[${label}] ${safeDetail}` : `[${label}]`;
}

export function messageSearchTypeIcon(type) {
  return TYPE_BY_VALUE.get(type)?.icon || '•';
}

export function formatSearchMessageSummary(message, t) {
  const content = String(message?.content || '').trim();
  const label = (type) => t(TYPE_BY_VALUE.get(type)?.labelKey || 'gs.typeText');

  switch (message?.type) {
    case 'text': return content;
    case 'image': return compact(label('image'), content);
    case 'voice': return compact(label('voice'));
    case 'video': return compact(label('video'), content);
    case 'file': return compact(label('file'), content);
    case 'contact_card': {
      const data = parseObject(content);
      return compact(label('contact_card'), data.remark || data.username || data.name);
    }
    case 'red_packet': {
      const data = parseObject(content);
      return compact(label('red_packet'), data.greeting);
    }
    case 'transfer': {
      const data = parseObject(content);
      return compact(label('transfer'), data.note);
    }
    case 'merged': {
      const data = parseObject(content);
      return compact(label('merged'), data.title);
    }
    case 'call': return compact(label('call'), content);
    default: return content || compact(t('gs.unknownType'));
  }
}
