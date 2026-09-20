const { Worker: RealWorker } = require('worker_threads');
const Database = require('better-sqlite3');
const fs = require('fs'), path = require('path'), os = require('os');
const { applySchema } = require('../src/db/schema');

test.each([
 ['before commit', ['before'], 'write'],
 ['after commit before ack', ['after'], 'write'],
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
    parentPort.postMessage=msg=>{if(workerData.stage==='after' && msg.type==='ack')process.exit(32);post(msg)};
    require(workerData.script);`,{eval:true,workerData:{...options.workerData,dbPath,script,stage}});
  }
 }}));
 let writer; jest.isolateModules(()=>{writer=require('../src/db/writer')});
 try {
  const ops=['A','B','C'].map(x=>{
   const update={sql:'UPDATE recovery_probe SET value=value||?, count=count+1 WHERE id=1',params:[x]};
   if(mode==='batch') return writer.writeBatch([{sql:'INSERT INTO recovery_unique(id) VALUES (?)',params:[x]},update]);
   if(mode==='sequence') return writer.writeSequencedEvent({conversationId:'recovery-conv',event:{id:`event:${x}`,eventType:'message_created',messageId:x,actorId:'synthetic',createdAt:1},ops:[update]});
   return writer.writeAsync(update.sql,update.params);
  });
  const settled=await Promise.allSettled(ops);
  expect(settled.map(x=>x.status)).toEqual(['fulfilled','fulfilled','fulfilled']);
  if(mode==='sequence') expect(settled.map(x=>x.value.server_sequence)).toEqual([1,2,3]);
  expect(db.prepare('SELECT value,count FROM recovery_probe').get()).toEqual({value:'ABC',count:3});
 } finally {await writer.shutdown();db.close();fs.rmSync(root,{recursive:true,force:true});jest.dontMock('worker_threads');}
},15000);
