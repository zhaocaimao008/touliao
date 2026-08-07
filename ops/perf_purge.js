#!/usr/bin/env node
/** 彻底清除压测账号及其所有痕迹：按 wechat_id 前缀删 users，级联删 contacts / messages / conversation_members / 空会话。 */
'use strict';
const path=require('path');
const Database=require(path.join(process.cwd(),'node_modules/better-sqlite3'));
const PREFIX=process.env.PREFIX; // 如 PERFBOT1785137693  为空则清所有 PERFBOT%
const db=new Database('wechat.db');
const like=PREFIX?PREFIX+'%':'PERFBOT%';
const ids=db.prepare(`SELECT id FROM users WHERE wechat_id LIKE ?`).all(like).map(r=>r.id);
if(!ids.length){console.log('无匹配压测账号');process.exit(0);}
const ph=ids.map(()=>'?').join(',');
const tx=db.transaction(()=>{
  // 找这些 bot 参与的会话
  const convs=db.prepare(`SELECT DISTINCT conversation_id FROM conversation_members WHERE user_id IN (${ph})`).all(...ids).map(r=>r.conversation_id);
  // 删这些会话里的所有消息 + 成员 + 会话本身（都是 bot 专属会话）
  let delMsg=0,delConv=0;
  for(const cid of convs){
    delMsg+=db.prepare('DELETE FROM messages WHERE conversation_id=?').run(cid).changes;
    db.prepare('DELETE FROM conversation_members WHERE conversation_id=?').run(cid);
    delConv+=db.prepare('DELETE FROM conversations WHERE id=?').run(cid).changes;
  }
  const delC=db.prepare(`DELETE FROM contacts WHERE user_id IN (${ph}) OR contact_id IN (${ph})`).run(...ids,...ids).changes;
  // 清可能存在的其它关联（best-effort，不存在的表忽略）
  for(const t of ['device_tokens','push_subscriptions','user_settings','sessions','conversation_settings','friend_requests','blocked_users']){
    try{
      if(t==='friend_requests') db.prepare(`DELETE FROM ${t} WHERE from_id IN (${ph}) OR to_id IN (${ph})`).run(...ids,...ids);
      else if(t==='blocked_users') db.prepare(`DELETE FROM ${t} WHERE user_id IN (${ph}) OR blocked_id IN (${ph})`).run(...ids,...ids);
      else db.prepare(`DELETE FROM ${t} WHERE user_id IN (${ph})`).run(...ids);
    }catch(_){}
  }
  const delU=db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids).changes;
  console.log(`✅ 清理完成: 账号 ${delU}  消息 ${delMsg}  会话 ${delConv}  好友关系 ${delC}`);
});
tx();
