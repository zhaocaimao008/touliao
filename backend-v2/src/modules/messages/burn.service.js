'use strict';
const { db } = require('../../db/connection');
// Lazy imports avoid the conversation/sync/shared dependency cycle.

// 2026-10-11：待开始焚毁的候选消息，按调用形态选有界执行计划（结果集与原「conversation_id=? AND rowid<=? AND
// (? IS NULL OR id=?)」逐行相同，只是不再每次走 idx_messages_conv_del_time 把整个会话的未删消息逐行回表）：
//  - byId：recordDelivery / ack/read 只处理一条消息。原写法 (? IS NULL OR id=?) 让 id 主键索引失效，退化成全会话扫描；
//  - range：markRead 传入上次已读水位 afterRowid，只看 (afterRowid, rowid]，走 rowid 主键区间。+conversation_id/+deleted
//    屏蔽会话索引——没有 sqlite_stat1（代码从不 ANALYZE）时规划器宁选会话索引全会话扫也不用 rowid 区间；
//    区间内是全库消息（含其他会话），故只在跨度 ≤ ROWID_RANGE_SCAN_MAX 时用（最坏几千行，亚毫秒）；
//  - convAfter：跨度大（很久没读、期间全库消息多）时仍走会话索引，+rowid>? 在索引项上先过滤，水位以下的旧消息不回表；
//  - conv：没有可信水位（首次已读/水位消息已删等），即原全会话扫描。
// 清空水位的 rowid 比较加 +：否则它也是 rowid 下界，规划器可能拿它（常为 0）当区间起点扫全表。
const ROWID_RANGE_SCAN_MAX=4096; // 与 conversations.service markRead 回填 message_reads 的同名阈值同口径
const BURN_CANDIDATE_WHERE={
 byId:'id=? AND conversation_id=? AND rowid<=? AND deleted=0',
 range:'rowid>? AND rowid<=? AND +conversation_id=? AND +deleted=0',
 convAfter:'conversation_id=? AND rowid<=? AND deleted=0 AND +rowid>?',
 conv:'conversation_id=? AND rowid<=? AND deleted=0',
};
const BURN_CANDIDATE_TAIL=`sender_id!=? AND burn_after>0 AND burn_read_at IS NULL
    AND +rowid>COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=?),0)
    AND NOT EXISTS(SELECT 1 FROM user_message_deletions d WHERE d.message_id=messages.id AND d.user_id=?)`;
const burnCandidateStmts=new Map();
function burnCandidates(userId, conversationId, rowid, onlyMessageId, afterRowid) {
 let kind,args;
 if(onlyMessageId!=null) {kind='byId';args=[onlyMessageId,conversationId,rowid];}
 else if(afterRowid==null) {kind='conv';args=[conversationId,rowid];}
 else if(rowid-afterRowid<=ROWID_RANGE_SCAN_MAX) {kind='range';args=[afterRowid,rowid,conversationId];}
 else {kind='convAfter';args=[conversationId,rowid,afterRowid];}
 let stmts=burnCandidateStmts.get(kind);
 if(!stmts) {
  const where=`${BURN_CANDIDATE_WHERE[kind]} AND ${BURN_CANDIDATE_TAIL}`;
  stmts={rows:db.prepare(`SELECT id,burn_after FROM messages WHERE ${where}`),exists:db.prepare(`SELECT 1 FROM messages WHERE ${where} LIMIT 1`)};
  burnCandidateStmts.set(kind,stmts);
 }
 return {...stmts,args:[...args,userId,userId,conversationId,userId]};
}
// afterRowid（可选）：调用方保证 rowid<=afterRowid 的候选已在之前的 recordRead 中处理过（markRead 传上次已读水位）。
// 2026-10-11：先在锁外用同一条件做存在性预检，没有候选就直接返回，不在主线程开 BEGIN IMMEDIATE 抢写锁（connection.js
// 「主线程永不等写锁」）。预检安全：对 rowid<=上界 的候选集只会并发缩小（burn_after 由插入触发器同事务写定；burn_read_at、
// deleted、cleared_rowid、个人删除只朝排除方向变；新消息 rowid 必大于已存在的上界），锁外 0 行 → 锁内也 0 行。
// 有候选时仍在 IMMEDIATE 事务里按同一条件重选，原子性与事件/序号写法与原来完全一致。
function recordRead(io, userId, conversationId, rowid, onlyMessageId=null, afterRowid=null) {
 if(afterRowid!=null && afterRowid>=rowid) return []; // (afterRowid, rowid] 为空：上次已处理到更后面
 const candidates=burnCandidates(userId,conversationId,rowid,onlyMessageId,afterRowid);
 if(!candidates.exists.get(...candidates.args)) return [];
 const now=Math.floor(Date.now()/1000);
 const changed=db.transaction(()=>{
  const rows=candidates.rows.all(...candidates.args);
  return rows.map(m=>{
   const payload={burn_read_at:String(now),burn_expires_at:String(now+m.burn_after)};
   const sequence=require('./sync.service').appendConversationEventTx({conversationId,eventType:'message_burn_started',messageId:m.id,actorId:userId,payload,
    apply:()=>db.prepare('UPDATE messages SET burn_read_at=?,burn_expires_at=? WHERE id=? AND burn_read_at IS NULL').run(now,now+m.burn_after,m.id)});
   return {id:m.id,sequence,payload};
  });
 }).immediate();
 for(const m of changed) {
  io?.to(conversationId).emit('message_burn_started',{conversationId,msgId:m.id,...m.payload});
  require('./sync.service').emitSyncAvailable(io,conversationId,m.sequence);
 }
 return changed;
}
function expireDueMessages(io=null, now=Math.floor(Date.now()/1000)) {
 if (!db.prepare('SELECT 1 FROM messages WHERE deleted=0 AND burn_expires_at<=? LIMIT 1').get(now)) return 0;
 const expired=db.transaction(()=>{
  const rows=db.prepare('SELECT id,conversation_id,sender_id,file_url FROM messages WHERE deleted=0 AND burn_expires_at<=?').all(now);
  return rows.map(m=>{
   const sequence=require('./sync.service').appendConversationEventTx({conversationId:m.conversation_id,eventType:'message_vanished',messageId:m.id,actorId:m.sender_id,
    payload:{reason:'burn_expired'},apply:()=>{
     if(m.file_url) {
      const revoke=db.prepare('INSERT OR IGNORE INTO revoked_burn_files(path,message_id,revoked_at) VALUES (?,?,?)');
      revoke.run(m.file_url,m.id,now);
      revoke.run(m.file_url.replace(/\.[a-zA-Z0-9]+$/, '')+'_thumb.webp',m.id,now);
     }
     db.prepare("UPDATE messages SET deleted=2,content='',file_url='',transcript=NULL WHERE id=?").run(m.id);
     db.prepare("UPDATE conversation_events SET payload='{}' WHERE message_id=?").run(m.id);
     db.prepare('DELETE FROM pinned_messages WHERE message_id=?').run(m.id);
     if (m.id.startsWith('scheduled:')) db.prepare("UPDATE scheduled_messages SET content='' WHERE id=?").run(m.id.slice(10));
    }});
   return {...m,sequence};
  });
 }).immediate();
 for(const m of expired) {
  require('../../realtime/broadcaster').purgeQueuedMessage(m.conversation_id,m.id);
  require('../conversations/conversations.service').invalidateConvCacheForConversation(m.conversation_id);
  require('../../utils/cache').delPattern('search:*').catch(()=>{});
  io?.to(m.conversation_id).emit('message_vanished',{conversationId:m.conversation_id,msgId:m.id});
  require('./sync.service').emitSyncAvailable(io,m.conversation_id,m.sequence);
 }
 return expired.length;
}
// A body delivered by REST is a read for burn purposes, even without an ack.
// Callers already selected visible rows; recordRead rechecks tombstones under lock.
function recordDelivery(userId, messages, io=null) {
 const candidates=messages.filter(m=>m && m.id && m.burn_after>0 && !m.deleted && m.sender_id!==userId);
 if (!candidates.length) return;
 for (const m of candidates) {
   if (!m.burn_expires_at) recordRead(io,userId,m.conversation_id,Number.MAX_SAFE_INTEGER,m.id);
   const state=db.prepare('SELECT burn_read_at,burn_expires_at FROM messages WHERE id=?').get(m.id);
   Object.assign(m,state);
 }
}
function assertMergedForwardAllowed(content) {
 let payload;
 try { payload=JSON.parse(content); } catch { return; } // Preserve existing non-burn payload compatibility.
 for (const item of Array.isArray(payload?.items) ? payload.items : []) {
  if (item?.burn_after>0 || (typeof item?.mid==='string' && db.prepare('SELECT 1 FROM messages WHERE id=? AND burn_after>0').get(item.mid))) {
   throw require('../../utils/http').forbidden('阅后即焚消息不能合并转发');
  }
 }
}
let timer;
function startBurnExpiry(io) {
 if(timer) return timer;
 expireDueMessages(io);
 timer=setInterval(()=>{try{expireDueMessages(io)}catch(e){console.error('[burn] expiry failed:',e.message)}},1000);
 timer.unref?.();return timer;
}
module.exports={assertMergedForwardAllowed,recordRead,recordDelivery,expireDueMessages,startBurnExpiry};
