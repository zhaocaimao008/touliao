#!/usr/bin/env node
/** 撤回并删除测试账号发给指定好友的“性能测试”消息（双向 forEveryone）。 */
'use strict';
const http = require('http');
const BASE = process.env.BASE || 'http://127.0.0.1:3002';
const PHONE = process.env.PHONE, PASS = process.env.PASS;
const FRIEND = process.env.FRIEND || '如歌';
const MARK = process.env.MARK || '性能测试';
const U = new URL(BASE); let TOKEN=null;
function req(m,p,b){return new Promise(r=>{const d=b?JSON.stringify(b):null;const h={'Content-Type':'application/json'};if(d)h['Content-Length']=Buffer.byteLength(d);if(TOKEN)h.Authorization='Bearer '+TOKEN;const rq=http.request({host:U.hostname,port:U.port||80,path:p,method:m,headers:h},res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>r({status:res.statusCode,body:s}));});rq.on('error',e=>r({status:0,body:String(e)}));if(d)rq.write(d);rq.end();});}
(async()=>{
  const lg=await req('POST','/api/auth/login',{phone:PHONE,password:PASS});
  TOKEN=JSON.parse(lg.body).token; const me=JSON.parse(lg.body).user.id;
  const ct=JSON.parse((await req('GET','/api/users/contacts')).body);
  const fr=ct.find(u=>u.remark===FRIEND||u.username===FRIEND);
  const cv=JSON.parse((await req('POST','/api/messages/conversation/private',{userId:fr.id})).body);
  const convId=cv.id||cv.conversationId;
  // 拉尽量多历史，筛出本账号发的、含标记的、未删的
  let all=[], before=null;
  for(let pg=0;pg<10;pg++){
    const q=before?`?limit=100&before=${before}`:'?limit=100';
    const h=JSON.parse((await req('GET',`/api/messages/${convId}${q}`)).body);
    const arr=Array.isArray(h)?h:(h.messages||h.items||[]);
    if(!arr.length)break;
    all=all.concat(arr); before=arr[0].id||arr[0]._id;
    if(arr.length<100)break;
  }
  const mine=all.filter(m=>(m.senderId===me||m.sender_id===me||m.fromId===me)&&typeof(m.content)==='string'&&m.content.includes(MARK)&&!(m.deleted));
  const ids=mine.map(m=>m.id||m._id);
  console.log(`会话 ${convId}：命中待撤回 ${ids.length} 条`);
  let done=0;
  for(let i=0;i<ids.length;i+=20){
    const batch=ids.slice(i,i+20);
    const r=await req('POST','/api/messages/batch-delete',{msgIds:batch,conversationId:convId,forEveryone:true});
    if(r.status===200){done+=batch.length;}else{console.log('batch-delete 失败',r.status,r.body.slice(0,120));
      // 回退：逐条 forEveryone
      for(const id of batch){const d=await req('DELETE',`/api/messages/${id}`,{forEveryone:true});if(d.status===200)done++;}
    }
  }
  console.log(`✅ 已撤回删除 ${done}/${ids.length} 条测试消息`);
})();
