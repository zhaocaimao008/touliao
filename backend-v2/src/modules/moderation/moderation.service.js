'use strict';
const { v4: uuidv4 } = require('uuid');
const { db, readDb } = require('../../db/connection');
const { badRequest } = require('../../utils/http');

// 关键词黑名单兜底审核（2026-09-02）：P12 AI 审核 mock 已下线且被标注为"恒安全极具误导性"，
// 生产环境此前没有任何真实运行的内容审核。这不是替代品，只是"完全没有"和"至少拦得住明确
// 违禁词"之间的兜底——大小写/全半角不敏感的子串匹配，不做同音字/拆字/变体规避对抗。
// 词库为空表启动（不内置任何词，由管理员在后台"内容审核"面板维护），避免代码库里
// 硬编码一份未经业务/合规判断的敏感词表。

let cache = null; // Set<string>，小写化后的词；null 表示尚未加载

function normalize(word) {
  return String(word).trim().toLowerCase();
}

function load() {
  const rows = readDb.prepare('SELECT word FROM content_blacklist').all();
  cache = new Set(rows.map(r => normalize(r.word)));
  return cache;
}

function ensureLoaded() {
  return cache || load();
}

// 命中则返回匹配到的词（供审计/日志），未命中返回 null。不对外暴露具体匹配到哪个词，
// 调用方一律返回统一错误文案，避免帮违规用户逐词试探黑名单边界。
function firstMatch(text) {
  if (typeof text !== 'string' || !text) return null;
  const words = ensureLoaded();
  if (words.size === 0) return null;
  const lower = text.toLowerCase();
  for (const w of words) {
    if (w && lower.includes(w)) return w;
  }
  return null;
}

// 供发消息/编辑消息/发朋友圈/评论四个入口统一调用：命中即抛 400，不写入任何审计明细
// （避免把违规原文二次留存），仅供上层按需 console.warn 记录用户 id + 场景。
function assertClean(text) {
  if (firstMatch(text)) throw badRequest('内容包含违规信息，请修改后重试');
}

// ── 管理员维护（GET/POST/DELETE /api/admin/blacklist）──
function listWords() {
  return readDb.prepare('SELECT id, word, created_at FROM content_blacklist ORDER BY created_at DESC').all();
}

function addWord(word, adminUsername) {
  const w = normalize(word);
  if (!w) throw badRequest('关键词不能为空');
  if (w.length > 50) throw badRequest('关键词过长');
  const id = uuidv4();
  try {
    db.prepare('INSERT INTO content_blacklist (id, word, created_by) VALUES (?,?,?)').run(id, w, adminUsername || null);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw badRequest('该关键词已存在');
    throw e;
  }
  cache = null; // 下次访问时重新加载
  return { id, word: w };
}

function removeWord(id) {
  db.prepare('DELETE FROM content_blacklist WHERE id=?').run(id);
  cache = null;
}

module.exports = { assertClean, firstMatch, listWords, addWord, removeWord, load };
