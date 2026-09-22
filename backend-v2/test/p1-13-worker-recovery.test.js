const { Worker: RealWorker } = require('worker_threads');
const Database = require('better-sqlite3');
const fs = require('fs'), path = require('path'), os = require('os');
const { applySchema } = require('../src/db/schema');

test.each([
 ['before commit', ['before'], 'write'],
 ['acknowledged receipts do not grow across 250 operations', [], 'volume'],
 ['after commit before ack', ['after'], 'write'],
 ['some acks delivered before crash', ['partial'], 'write'],
 ['crash again during recovery', ['before','after','before'], 'write'],
 ['unique batch committed before ack', ['after'], 'batch'],
 ['sequenced event committed before ack', ['after'], 'sequence'],
])('%s preserves FIFO and acknowledges durable success exactly once', async (_name, faults, mode) => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'touliao-worker-'));
 const dbPath=path.join(root,'worker.sqlite');const db=new Database(dbPath);applySchema(db);
 db.exec("CREATE TABLE recovery_probe(id INTEGER PRIMARY KEY, value TEXT, count INTEGER); INSERT INTO recovery_probe VALUES(1,'',0); CREATE TABLE recovery_unique(id TEXT PRIMARY KEY); INSERT INTO conversations(id,type) VALUES('recovery-conv','group')");
 let generation=0;
 jest.doMock('worker_threads',()=>({ Worker: class extends RealWorker {
  constructor(script,options) {
   const stage=faults[generation++];
   super(`const {parentPort,workerData}=require('worker_threads');
    const on=parentPort.on.bind(parentPort),post=parentPort.postMessage.bind(parentPort);
    parentPort.on=(name,fn)=>on(name,name==='message'?msg=>{if(workerData.stage==='before' && msg.reqId!=null)process.exit(31);fn(msg)}:fn);
    let ackCount=0;
    parentPort.postMessage=msg=>{if(msg.type==='ack' && workerData.stage==='partial' && ++ackCount===2)process.exit(33);if(workerData.stage==='after' && msg.type==='ack')process.exit(32);post(msg)};
    require(workerData.script);`,{eval:true,workerData:{...options.workerData,dbPath,script,stage}});
  }
 }}));
 let writer; jest.isolateModules(()=>{writer=require('../src/db/writer')});
 try {
  const values=mode==='volume'?Array.from({length:250},()=> 'A'):['A','B','C'];
  const ops=values.map(x=>{
   const update={sql:'UPDATE recovery_probe SET value=value||?, count=count+1 WHERE id=1',params:[x]};
   if(mode==='batch') return writer.writeBatch([{sql:'INSERT INTO recovery_unique(id) VALUES (?)',params:[x]},update]);
   if(mode==='sequence') return writer.writeSequencedEvent({conversationId:'recovery-conv',event:{id:`event:${x}`,eventType:'message_created',messageId:x,actorId:'synthetic',createdAt:1},ops:[update]});
   return writer.writeAsync(update.sql,update.params);
  });
  const settled=await Promise.allSettled(ops);
  expect(settled.map(x=>x.status)).toEqual(values.map(()=> 'fulfilled'));
  if(mode==='sequence') expect(settled.map(x=>x.value.server_sequence)).toEqual([1,2,3]);
  expect(db.prepare('SELECT value,count FROM recovery_probe').get()).toEqual({value:values.join(''),count:values.length});
  db.prepare('INSERT INTO writer_receipts(operation_id,result_json) VALUES (?,?)').run('other-active-session:1','null');
  await writer.shutdown();
  writer=null;
  expect(db.prepare('SELECT operation_id FROM writer_receipts').all()).toEqual([{operation_id:'other-active-session:1'}]);
 } finally {if(writer)await writer.shutdown();db.close();fs.rmSync(root,{recursive:true,force:true});jest.dontMock('worker_threads');}
},15000);
