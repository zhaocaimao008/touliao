'use strict';
const { Worker } = require('worker_threads');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
let dir, db, worker, dbPath;
function start(){return new Worker(path.join(__dirname,'../src/db/worker.js'),{workerData:{dbPath,flushMs:1}});}
function send(item){return new Promise((resolve,reject)=>{
  const onMessage=msg=>{if(msg.type==='ack'&&msg.ids.includes(item.reqId)){worker.off('message',onMessage);resolve(msg);}};
  worker.on('message',onMessage);worker.once('error',reject);worker.postMessage(item);
});}
beforeEach(()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'tl-writer-replay-'));dbPath=path.join(dir,'test.sqlite');db=new Database(dbPath);
  db.exec('CREATE TABLE counter (n INTEGER); INSERT INTO counter VALUES (0); CREATE TABLE ordered (n INTEGER); CREATE TABLE conversation_sequences (conversation_id TEXT PRIMARY KEY,last_sequence INTEGER); CREATE TABLE conversation_events (id TEXT PRIMARY KEY,conversation_id TEXT,server_sequence INTEGER,event_type TEXT,message_id TEXT,actor_id TEXT,target_user_id TEXT,payload TEXT,created_at INTEGER,batch_id TEXT,client_batch_id TEXT)');worker=start();
});
afterEach(async()=>{await worker.terminate();db.close();fs.rmSync(dir,{recursive:true,force:true});});
test.each(['write','writeBatch'])('%s survives committed-but-unacknowledged replay after worker restart',async(type)=>{
  const item={type,reqId:1,operationId:randomUUID(),sql:'UPDATE counter SET n=n+1',params:[]};
  if(type==='writeBatch')item.ops=[{sql:item.sql,params:[]},{sql:'INSERT INTO ordered VALUES (1)',params:[]}];
  expect((await send(item)).error).toBeUndefined(); // ACK deliberately discarded by caller
  await worker.terminate();worker=start();expect((await send(item)).error).toBeUndefined();
  expect(db.prepare('SELECT n FROM counter').get().n).toBe(1);
  if(type==='writeBatch')expect(db.prepare('SELECT COUNT(*) n FROM ordered').get().n).toBe(1);
});
test('sequenced event replay returns original sequence and commits once',async()=>{
  const item={type:'writeSequencedEvent',reqId:2,operationId:randomUUID(),conversationId:'c',ops:[{sql:'UPDATE counter SET n=n+1',params:[]}],event:{id:randomUUID(),eventType:'message_created',messageId:'m',actorId:'a',createdAt:1}};
  const first=await send(item);await worker.terminate();worker=start();const second=await send(item);
  expect(first.result).toEqual({server_sequence:1});expect(second.result).toEqual(first.result);
  expect(db.prepare('SELECT n FROM counter').get().n).toBe(1);expect(db.prepare('SELECT COUNT(*) n FROM conversation_events').get().n).toBe(1);
});
test('batch failure rolls back operation marker and domain writes, later items retain order',async()=>{
  const bad={type:'writeBatch',reqId:3,operationId:randomUUID(),ops:[{sql:'UPDATE counter SET n=n+1',params:[]},{sql:'INSERT INTO nonexistent VALUES (1)',params:[]}]};
  expect((await send(bad)).error).toMatch(/no such table/);
  expect(db.prepare('SELECT n FROM counter').get().n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) n FROM writer_operations').get().n).toBe(0);
  const results=await Promise.all([1,2,3].map(n=>send({type:'write',reqId:n+4,operationId:randomUUID(),sql:'INSERT INTO ordered VALUES (?)',params:[n]})));
  expect(results.every(r=>!r.error)).toBe(true);expect(db.prepare('SELECT n FROM ordered ORDER BY rowid').all().map(r=>r.n)).toEqual([1,2,3]);
});
