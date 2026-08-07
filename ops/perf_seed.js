#!/usr/bin/env node
/** 播种隔离压测账号并签发 JWT。全部账号 username=perf_bot_*, wechat_id=PERFBOT* 便于精准清理。 */
'use strict';
const path=require('path');
const Database=require(path.join(process.cwd(),'node_modules/better-sqlite3'));
const jwt=require('node_modules/jsonwebtoken'.replace('node_modules/',path.join(process.cwd(),'node_modules/')));
const { v4:uuid }=require(path.join(process.cwd(),'node_modules/uuid'));
const bcrypt=require(path.join(process.cwd(),'node_modules/bcryptjs'));
try{require(path.join(process.cwd(),'node_modules/dotenv')).config();}catch(_){}

const N=parseInt(process.env.BOTS||'20',10);
const SECRET=process.env.JWT_SECRET;
if(!SECRET){console.error('缺 JWT_SECRET(未从 .env 读到)');process.exit(1);}
const db=new Database('wechat.db');
const now=Math.floor(Date.now()/1000);
const pw=bcrypt.hashSync('perfbot_pw_'+now,8);
const ins=db.prepare(`INSERT INTO users(id,username,phone,password,wechat_id,bio,status,created_at) VALUES(?,?,?,?,?,?,?,?)`);
const insC=db.prepare(`INSERT OR IGNORE INTO contacts(id,user_id,contact_id,remark,created_at) VALUES(?,?,?,?,?)`);
const bots=[];
const tx=db.transaction(()=>{
  for(let i=0;i<N;i++){
    const id=uuid();
    const uname='perf_bot_'+now+'_'+i;
    const phone='99'+String(now).slice(-8)+String(i).padStart(2,'0'); // 99 前缀假号段，避开真人
    const wid='PERFBOT'+now+i;
    ins.run(id,uname,phone,pw,wid,'perf test bot','offline',now);
    const token=jwt.sign({id,username:uname,csrf:uuid()},SECRET,{algorithm:'HS256',expiresIn:'3600s'});
    bots.push({id,uname,token});
  }
  // 配对 bot[2k] ↔ bot[2k+1] 建双向好友，满足私聊会话的 contacts 校验
  for(let i=0;i+1<bots.length;i+=2){
    const a=bots[i],b=bots[i+1];
    insC.run(uuid(),a.id,b.id,'',now);
    insC.run(uuid(),b.id,a.id,'',now);
  }
});
tx();
require('fs').writeFileSync('/tmp/perf_bots.json',JSON.stringify(bots));
console.log(`✅ 播种 ${bots.length} 个隔离压测账号 → /tmp/perf_bots.json (wechat_id 前缀 PERFBOT${now})`);
console.log('   清理标记:', 'PERFBOT'+now);
