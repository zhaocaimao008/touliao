#!/usr/bin/env node
/**
 * 高并发写入压测：读 /tmp/perf_bots.json 的隔离账号，两两配对建私聊会话，
 * 所有账号同一时刻并发发消息，统计成功率 / 延迟分位 / 实测 QPS / 限流命中。
 * 仅在压测账号自己的会话内互发，绝不触碰真实用户。
 *
 * 环境: BASE, ROUNDS(每账号连发轮数), CONCURRENCY(并发批大小)
 */
'use strict';
const http=require('http'), https=require('https'), fs=require('fs');
const BASE=process.env.BASE||'http://127.0.0.1:3002';
const ROUNDS=parseInt(process.env.ROUNDS||'5',10);
const U=new URL(BASE);
const MOD=U.protocol==='https:'?https:http;
const PORT=U.port||(U.protocol==='https:'?443:80);
const bots=JSON.parse(fs.readFileSync('/tmp/perf_bots.json','utf8'));

function req(token,m,p,b){return new Promise(r=>{
  const d=b?JSON.stringify(b):null;
  const h={'Content-Type':'application/json','Authorization':'Bearer '+token};
  if(d)h['Content-Length']=Buffer.byteLength(d);
  const t0=process.hrtime.bigint();
  const rq=MOD.request({host:U.hostname,port:PORT,path:p,method:m,headers:h,agent:false,rejectUnauthorized:false},res=>{
    let s='';res.on('data',c=>s+=c);res.on('end',()=>r({status:res.statusCode,body:s,ms:Number(process.hrtime.bigint()-t0)/1e6}));
  });
  rq.on('error',e=>r({status:0,body:String(e),ms:0}));
  if(d)rq.write(d);rq.end();
});}
const stats=a=>{if(!a.length)return{n:0};const s=[...a].sort((x,y)=>x-y);const q=p=>s[Math.min(s.length-1,Math.floor(p*s.length))];
  return{n:s.length,p50:+q(.5).toFixed(1),p95:+q(.95).toFixed(1),p99:+q(.99).toFixed(1),max:+s[s.length-1].toFixed(1),avg:+(s.reduce((x,y)=>x+y,0)/s.length).toFixed(1)};};

(async()=>{
  // 配对建会话：bot[2k] ↔ bot[2k+1]
  const pairs=[];
  for(let i=0;i+1<bots.length;i+=2){
    const a=bots[i],b=bots[i+1];
    const cv=await req(a.token,'POST','/api/messages/conversation/private',{userId:b.id});
    if(cv.status===200){const c=JSON.parse(cv.body);pairs.push({sender:a,convId:c.id||c.conversationId});}
    else console.log('建会话失败',cv.status,cv.body.slice(0,80));
  }
  console.log(`配对会话: ${pairs.length} 对，发送方 ${pairs.length} 个并发`);

  // 爆发并发：ROUNDS 轮，每轮所有发送方“同时”各发 1 条 → 测瞬时并发写
  const all=[]; let ok=0,fail=0; const codes={};
  const wallStart=Date.now();
  for(let round=0;round<ROUNDS;round++){
    const batch=pairs.map(p=>req(p.sender.token,'POST',`/api/messages/${p.convId}`,{content:`stress r${round} @${Date.now()}`,type:'text'}));
    const res=await Promise.all(batch);
    for(const r of res){codes[r.status]=(codes[r.status]||0)+1;if(r.status===200){ok++;all.push(r.ms);}else fail++;}
  }
  const wallSec=(Date.now()-wallStart)/1000;
  const st=stats(all);
  console.log(`\n===== 高并发写入压测结果 =====`);
  console.log(`并发数: ${pairs.length}   轮数: ${ROUNDS}   总请求: ${ok+fail}`);
  console.log(`成功: ${ok}   失败: ${fail}   状态码分布: ${JSON.stringify(codes)}`);
  console.log(`墙钟耗时: ${wallSec.toFixed(2)}s   实测吞吐: ${(ok/wallSec).toFixed(1)} msg/s`);
  console.log(`写延迟(ms): p50=${st.p50}  p95=${st.p95}  p99=${st.p99}  max=${st.max}  avg=${st.avg}`);
})();
