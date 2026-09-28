// 群系统提示（type='system'）渲染：file_url 里是服务端写入的结构化信息
//   { event, actorId, actorName, targets: [{ id, name }], name? }
// 涉及自己时显示「你」；解析失败或未知事件时退回 content 原文（服务端写的中性人话）。
const MAX_NAMES = 10;

export function groupSystemText(msg, myId, t) {
  let meta;
  try { meta = JSON.parse(msg.file_url || ''); } catch { meta = null; }
  const key = meta?.event ? `sys.${meta.event}` : null;
  const tpl = key ? t(key) : null;
  if (!tpl || tpl === key) return msg.content || '';
  const you = t('sys.you');
  const nameOf = (id, name) => (String(id) === String(myId) ? you : name || t('messageItem.someone'));
  const targets = Array.isArray(meta.targets) ? meta.targets : [];
  const shown = targets.slice(0, MAX_NAMES).map(x => nameOf(x.id, x.name)).join(t('sys.nameSeparator'));
  const targetText = targets.length > MAX_NAMES ? t('sys.andMoreTemplate').replace('{names}', shown).replace('{n}', targets.length) : shown;
  return tpl
    .replace('{actor}', nameOf(meta.actorId, meta.actorName))
    .replace('{targets}', targetText)
    .replace('{name}', meta.name || '');
}

// 会话列表预览只有 content（中性文案，以操作者名字开头）：操作者是自己时换成「你」
export function groupSystemPreview(content, myName, t) {
  const text = content || '';
  return myName && text.startsWith(`${myName} `) ? t('sys.you') + text.slice(myName.length) : text;
}
