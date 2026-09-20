'use strict';
const { db } = require('../../db/connection');
// Lazy imports avoid the conversation/sync/shared dependency cycle.
function recordRead(io, userId, conversationId, rowid, onlyMessageId=null) {
 const now=Math.floor(Date.now()/1000);
 const changed=db.transaction(()=>{
  const rows=db.prepare(`SELECT id,burn_after FROM messages WHERE conversation_id=? AND rowid<=?
    AND (? IS NULL OR id=?) AND sender_id!=? AND deleted=0 AND burn_after>0 AND burn_read_at IS NULL
    AND rowid>COALESCE((SELECT cleared_rowid FROM conversation_clears WHERE user_id=? AND conversation_id=?),0)
    AND NOT EXISTS(SELECT 1 FROM user_message_deletions d WHERE d.message_id=messages.id AND d.user_id=?)`)
    .all(conversationId,rowid,onlyMessageId,onlyMessageId,userId,userId,conversationId,userId);
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
     if(m.file_url) db.prepare('INSERT OR IGNORE INTO revoked_burn_files(path,message_id,revoked_at) VALUES (?,?,?)').run(m.file_url,m.id,now);
     db.prepare("UPDATE messages SET deleted=2,content='',file_url='',transcript=NULL WHERE id=?").run(m.id);
     db.prepare("UPDATE conversation_events SET payload='{}' WHERE message_id=?").run(m.id);
     db.prepare('DELETE FROM pinned_messages WHERE message_id=?').run(m.id);
     db.prepare("UPDATE scheduled_messages SET content='' WHERE 'scheduled:'||id=?").run(m.id);
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
let timer;
function startBurnExpiry(io) {
 if(timer) return timer;
 expireDueMessages(io);
 timer=setInterval(()=>{try{expireDueMessages(io)}catch(e){console.error('[burn] expiry failed:',e.message)}},1000);
 timer.unref?.();return timer;
}
module.exports={recordRead,expireDueMessages,startBurnExpiry};
