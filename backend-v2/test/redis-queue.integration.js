'use strict';
const assert = require('assert/strict');
if(!process.env.TEST_REDIS_URL)throw new Error('Use the private Redis runner');
const { redisCache }=require('../src/integrations/redisCache');
(async()=>{
  const url=new URL(process.env.TEST_REDIS_URL);
  await redisCache.connect({host:url.hostname,port:Number(url.port),db:6});
  try {
    const MessageQueue=require('../src/utils/messageQueue'),AckManager=require('../src/utils/ackManager');
    const q=new MessageQueue(),ack=new AckManager();
    await q.enqueue('integration',{id:'one'});await q.enqueue('integration',{id:'two'});
    assert.equal((await q.dequeue('integration',1)).id,'one');assert.equal((await q.dequeue('integration',1)).id,'two');
    await ack.recordDelivery('one','reader');await ack.recordDelivery('one','reader');await ack.recordRead('one','reader');
    assert.deepEqual(await ack.getDeliveredUsers('one'),['reader']);assert.deepEqual(await ack.getReadUsers('one'),['reader']);
    assert.ok(await redisCache.client.ttl('read:one')>0);
    await q._sendToDLQ('integration',{id:'failed'},new Error('fixture failure'),3);
    const dead=await q.getDLQMessages('integration',10);assert.equal(dead[0].id,'failed');
    console.log('Real Redis queue/ACK regressions: 6 assertions passed (FIFO, deduplication, read, TTL, DLQ).');
    process.env.REDIS_URL=process.env.TEST_REDIS_URL;process.env.DISABLE_RATE_LIMIT='0';
    const limiters=require('../src/middleware/rateLimiters');await limiters.ready;
    const app=require('express')();app.use(require('express').json());app.post('/login',limiters.loginLimiter,(_req,res)=>res.status(401).end());
    const request=require('supertest');
    try {
      for(let i=0;i<5;i++)await request(app).post('/login').send({phone:'audit-limit'}).expect(401);
      await request(app).post('/login').send({phone:'audit-limit'}).expect(429);
      const check=redisCache.client.duplicate({db:3});
      try {assert.equal(await check.get('rl:login:audit-limit'),'6');} finally {await check.quit();}
      console.log('Real Redis rate-limit regression: 7 assertions passed (five failures, 429, shared Redis counter).');
    } finally {await limiters.close();}
  } finally {await redisCache.disconnect();}
})().catch(e=>{console.error(e);process.exitCode=1;});
