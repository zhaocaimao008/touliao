'use strict';
/**
 * 收藏去重键计算（CO1）。
 * 三条收藏写入路径（用户自定义收藏 / 收藏消息 / 收藏表情）共用 collections 表，
 * 此前去重失效（表无唯一约束，服务层 try/catch 是死代码 → 同一内容可无限重复收藏）。
 *
 * dedup_key 语义：同一 user_id 下，相同「类型 + 内容标识」视为同一收藏。
 *   - 非文本且带文件 URL（image/file/video/sticker）：以 URL 作为身份（同图同文件不重复收藏）
 *   - 其余（text 等）：以内容文本的哈希作为身份（避免长文本直接进索引）
 */
const crypto = require('crypto');

function collectionDedupKey(type, content, extra = {}) {
  const url = extra && (extra.file_url || extra.url);
  const basis = (type !== 'text' && url)
    ? String(url)
    : (typeof content === 'string' ? content : JSON.stringify(content));
  const hash = crypto.createHash('sha1').update(basis || '').digest('hex');
  return `${type}:${hash}`;
}

module.exports = { collectionDedupKey };
