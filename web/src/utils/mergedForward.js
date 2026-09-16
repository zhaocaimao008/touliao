export const FORWARDABLE_MESSAGE_TYPES = new Set([
  'text', 'image', 'voice', 'video', 'file', 'contact_card', 'merged',
]);

export function isForwardableMessage(message) {
  return !!message && !message.deleted && FORWARDABLE_MESSAGE_TYPES.has(message.type);
}

function contactName(content) {
  try {
    const card = JSON.parse(content || '{}');
    return card.username || card.name || '';
  } catch {
    return '';
  }
}

function mergedTitle(content) {
  try { return JSON.parse(content || '{}').title || ''; }
  catch { return ''; }
}

export function messageSnippet(message, labels = {}) {
  const label = type => labels[type] || `[${type}]`;
  if (message.type === 'text') return String(message.content || '').slice(0, 80);
  if (message.type === 'voice') {
    const duration = Number(message.duration) || 0;
    return `${label('voice')}${duration ? ` ${duration}${labels.seconds || 's'}` : ''}`;
  }
  if (message.type === 'contact_card') {
    const name = contactName(message.content);
    return `${label('contact')}${name ? ` ${name}` : ''}`;
  }
  if (message.type === 'merged') {
    const title = mergedTitle(message.content);
    return `${label('merged')}${title ? ` ${title}` : ''}`;
  }
  const filename = String(message.content || '').trim();
  return `${label(message.type)}${filename ? ` ${filename}` : ''}`;
}

export function buildMergedPayload(messages, { title, labels } = {}) {
  const items = (Array.isArray(messages) ? messages : [])
    .filter(isForwardableMessage)
    .slice(0, 30)
    .map(message => ({
      mid: message.id,
      type: message.type,
      sender: message.sender_id,
      senderName: message.senderName || message.sender_name || '',
      snippet: messageSnippet(message, labels),
      ts: message.created_at,
    }));
  return { title: title || `${items.length}`, items };
}
