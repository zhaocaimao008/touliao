'use strict';
// Real independent processes, real Redis pub/sub. No mocked adapter or production endpoint.
const { fork } = require('child_process');
const assert = require('assert/strict');
if (!process.env.TEST_REDIS_URL) throw new Error('Use scripts/with-test-redis.js');
process.env.REDIS_URL=process.env.TEST_REDIS_URL;
const events=require('../src/realtime/securityEvents');
if(process.argv.includes('--subscriber')) {
  events.bind({to:room=>({disconnectSockets:()=>process.send({room})}),close(){}});
  events.ready().then(()=>process.send({ready:true}));
  process.on('message',async msg=>{if(msg==='close'){await events.close();process.disconnect();}});
} else {
  (async()=>{
    const child=fork(__filename,['--subscriber'],{stdio:['ignore','inherit','inherit','ipc']});
    const messages=[];child.on('message',msg=>messages.push(msg));
    const waitFor=async predicate=>{
      const deadline=Date.now()+5000;
      while(!messages.some(predicate)){if(Date.now()>deadline)throw new Error('Redis cross-process delivery timeout');await new Promise(r=>setTimeout(r,20));}
    };
    try {
      await waitFor(m=>m.ready);await events.revoke('audit-user',['audit-session']);
      await waitFor(m=>m.room==='session_audit-session');
      await events.revoke('audit-user');await waitFor(m=>m.room==='user_audit-user');
      assert.equal(messages.filter(m=>m.room==='session_audit-session').length,1);
      console.log('Redis cross-process regressions: 3 assertions passed (session, user, no duplicate).');
    } finally {await events.close();child.send('close');await new Promise(r=>child.once('exit',r));}
  })().catch(e=>{console.error(e);process.exitCode=1;});
}
