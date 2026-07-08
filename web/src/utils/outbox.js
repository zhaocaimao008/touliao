// ================================================================
// outbox.js — 失败消息本地待发件箱
// ----------------------------------------------------------------
// 目的：让「发送失败」的文本消息在切换会话 / 刷新页面后依然不丢失。
// 顶级 IM 的标配——你发出去没成功的消息永远还在，直到它成功或被你删掉。
//
// 存储结构：localStorage[`outbox_${convId}`] = JSON([{...msg}])
// 每条 msg 复用 ChatWindow 里的乐观消息形态，关键字段：
//   id / _tempId（同值，作幂等 clientMsgId）、content、type、
//   reply_to_id、created_at、_status:'error'
// 仅持久化「纯文本」类消息（type==='text'）——图片/文件/语音等含大
// 二进制或上传态，不适合塞进 localStorage，保持轻量。
// ================================================================

const KEY = (convId) => `outbox_${convId}`;
const MAX_PER_CONV = 50; // 每会话最多留 50 条，防止异常膨胀

function safeParse(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 读取某会话的待发件箱（数组，可能为空） */
export function loadOutbox(convId) {
  if (!convId) return [];
  return safeParse(localStorage.getItem(KEY(convId)));
}

/** 覆写某会话的待发件箱 */
function saveOutbox(convId, list) {
  if (!convId) return;
  try {
    if (!list.length) localStorage.removeItem(KEY(convId));
    else localStorage.setItem(KEY(convId), JSON.stringify(list.slice(-MAX_PER_CONV)));
  } catch {
    // localStorage 满 / 隐私模式：静默降级，不影响主流程
  }
}

/** 新增或更新一条失败消息（按 _tempId 去重） */
export function upsertOutbox(convId, msg) {
  if (!convId || !msg || msg.type !== 'text') return;
  const key = msg._tempId || msg.id;
  if (!key) return;
  const list = loadOutbox(convId);
  const idx = list.findIndex((m) => (m._tempId || m.id) === key);
  const slim = {
    id: msg.id,
    _tempId: msg._tempId || msg.id,
    conversation_id: convId,
    sender_id: msg.sender_id,
    senderName: msg.senderName,
    senderAvatar: msg.senderAvatar,
    content: msg.content,
    type: 'text',
    file_url: '',
    created_at: msg.created_at || Math.floor(Date.now() / 1000),
    reply_to_id: msg.reply_to_id || null,
    replyTo: msg.replyTo || null,
    deleted: 0,
    edited: 0,
    reactions: [],
    _status: 'error',
  };
  if (idx >= 0) list[idx] = slim;
  else list.push(slim);
  saveOutbox(convId, list);
}

/** 消息成功送达后，从待发件箱移除（按 _tempId 或原 id 匹配） */
export function removeFromOutbox(convId, tempIdOrId) {
  if (!convId || !tempIdOrId) return;
  const list = loadOutbox(convId);
  const next = list.filter((m) => (m._tempId || m.id) !== tempIdOrId && m.id !== tempIdOrId);
  if (next.length !== list.length) saveOutbox(convId, next);
}
