'use strict';
const { request, app, makeUser, befriend, privateConversation } = require('./helpers');
const { db } = require('../src/db/connection');
const { v4: uuid } = require('uuid');
describe('客户端消息搜索分页',()=>{
  let user,convId,ids=[];
  beforeAll(async()=>{
    user=await makeUser(); const peer=await makeUser(); await befriend(user,peer);convId=await privateConversation(user,peer);
    const insert=db.prepare('INSERT INTO messages (id,conversation_id,sender_id,type,content,created_at) VALUES (?,?,?,?,?,?)');
    for(let i=0;i<13;i++){const id=uuid();ids.push(id);insert.run(id,convId,user.userId,'text',`分页检索校验 ${i}`,Math.floor(Date.now()/1000));}
    ids.reverse();
  });
  test.each([
    ['global','分页检索校验',''],['global','验',''],['global','分页检索校验','&type=text'],
    ['conversation','分页检索校验',''],['conversation','验',''],['conversation','分页检索校验','&type=text'],
  ])('%s %s %s supports stable pages for same-second messages',async(scope,q,filter)=>{
    const path=scope==='global'?'/api/messages/search':`/api/messages/conversation/${convId}/search`;
    const all=[];
    for(const offset of [0,5,10]){
      const result=await request(app).get(`${path}?q=${encodeURIComponent(q)}&limit=5&offset=${offset}${filter}`).set('Authorization',`Bearer ${user.token}`);
      expect(result.status).toBe(200);const rows=scope==='global'?result.body.results:result.body;
      if(scope==='global') expect(result.body.total).toBe(13);
      all.push(...rows.map(row=>row.id));
    }
    expect(all).toEqual(ids); expect(new Set(all).size).toBe(13);
  });
  test('conversation pagination rejects invalid offsets and limits',async()=>{
    for(const suffix of ['limit=-1','offset=-1','offset=abc']){
      const result=await request(app).get(`/api/messages/conversation/${convId}/search?q=${encodeURIComponent('验')}&${suffix}`).set('Authorization',`Bearer ${user.token}`);
      expect(result.status).toBe(400);
    }
  });
});
