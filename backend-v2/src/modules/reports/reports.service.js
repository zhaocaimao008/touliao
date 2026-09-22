'use strict';
const { randomUUID } = require('crypto');
const { db } = require('../../db/connection');
const { badRequest, notFound, forbidden, conflict } = require('../../utils/http');
const statuses = ['pending','reviewing','resolved','dismissed'];
function snapshotFor(userId, type, id) {
  if (type === 'support' && id === 'support') return '客服问题';
  if (type === 'user') {
    if (id === userId) throw badRequest('不能举报自己');
    const u = db.prepare('SELECT username,wechat_id FROM users WHERE id=?').get(id);
    if (!u) throw notFound('用户不存在');
    return JSON.stringify(u);
  }
  if (type === 'group') {
    const g = db.prepare(`SELECT c.id,c.name FROM conversations c JOIN conversation_members cm
      ON cm.conversation_id=c.id WHERE c.id=? AND c.type='group' AND cm.user_id=?`).get(id,userId);
    if (!g) throw forbidden('无权举报该群');
    return JSON.stringify(g);
  }
  if (type === 'message') {
    const m = db.prepare(`SELECT m.id,m.type,m.sender_id,m.content,m.file_url FROM messages m
      JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=?
      WHERE m.id=? AND m.deleted=0 AND m.burn_after=0
      AND NOT EXISTS(SELECT 1 FROM user_message_deletions d WHERE d.message_id=m.id AND d.user_id=?)
      AND m.rowid>COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=m.conversation_id),0)`).get(userId,id,userId,userId);
    if (!m) throw forbidden('消息不可举报，请改为举报用户或群');
    m.content = String(m.content || '').slice(0,4000);
    return JSON.stringify(m);
  }
  throw badRequest('无效举报类型');
}
function create(userId, body={}) {
  const {targetType,targetId,reason} = body;
  if (typeof targetId !== 'string' || !targetId || targetId.length>200 || typeof reason !== 'string' || !reason.trim() || reason.length>1000) throw badRequest('请填写举报目标及 1–1000 字理由');
  return db.transaction(() => {
    const snapshot = snapshotFor(userId,targetType,targetId);
    // Repeated clicks/retries reuse the open ticket, preserving its original evidence.
    const existing = db.prepare(`SELECT id,status FROM safety_reports WHERE reporter_id=? AND target_type=? AND target_id=? AND reason=? AND status IN ('pending','reviewing')`).get(userId,targetType,targetId,reason.trim());
    if (existing) return existing;
    const id = randomUUID();
    db.prepare('INSERT INTO safety_reports(id,reporter_id,target_type,target_id,snapshot,reason) VALUES (?,?,?,?,?,?)').run(id,userId,targetType,targetId,snapshot,reason.trim());
    db.prepare('INSERT INTO safety_report_events(report_id,status,note,actor) VALUES (?,?,?,?)').run(id,'pending','工单已提交',userId);
    return { id, status:'pending' };
  })();
}
function list(userId, query={}, admin=false) {
  const limit = Math.max(1,Math.min(parseInt(query.limit)||30,100));
  const offset = Math.max(0,parseInt(query.offset)||0);
  const where = []; const params = [];
  if (!admin) { where.push('reporter_id=?'); params.push(userId); }
  if (query.status) {
    if (!statuses.includes(query.status)) throw badRequest('无效状态');
    where.push('status=?'); params.push(query.status);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM safety_reports ${clause}`).get(...params).n;
  const fields = admin ? '*' : 'id,target_type,target_id,reason,status,resolution,created_at,updated_at';
  const items = db.prepare(`SELECT ${fields} FROM safety_reports ${clause} ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?`).all(...params,limit,offset);
  return {items,total,limit,offset,hasMore:offset+items.length<total};
}
function detail(userId,id,admin=false) {
  const row = db.prepare('SELECT * FROM safety_reports WHERE id=?').get(id);
  if (!row || (!admin && row.reporter_id!==userId)) throw notFound('工单不存在');
  const events = db.prepare(`SELECT status,note,created_at${admin ? ',actor' : ''} FROM safety_report_events WHERE report_id=? ORDER BY id`).all(id);
  if (!admin) { delete row.snapshot; delete row.reporter_id; delete row.handled_by; }
  return {...row,events};
}
function resolve(id,{status,note}={},admin) {
  if (!['reviewing','resolved','dismissed'].includes(status) || typeof note!=='string' || !note.trim() || note.length>1000) throw badRequest('请选择处理状态并填写 1–1000 字处理说明');
  return db.transaction(() => {
    const row = db.prepare('SELECT status FROM safety_reports WHERE id=?').get(id);
    if (!row) throw notFound('工单不存在');
    if (['resolved','dismissed'].includes(row.status)) throw conflict('工单已结束');
    if (row.status === status) throw conflict('状态未发生变化');
    if (row.status==='pending' && status==='resolved') throw conflict('请先受理工单再完成处理');
    db.prepare("UPDATE safety_reports SET status=?,resolution=?,handled_by=?,updated_at=strftime('%s','now') WHERE id=?").run(status,note.trim(),admin,id);
    db.prepare('INSERT INTO safety_report_events(report_id,status,note,actor) VALUES (?,?,?,?)').run(id,status,note.trim(),admin);
    return detail(null,id,true);
  })();
}
module.exports = {create,list,detail,resolve};
