'use strict';
const { EventEmitter } = require('events');
test('worker restart preserves outstanding and queued operation order, including fire-and-forget',async()=>{
  jest.useFakeTimers();const workers=[];
  jest.doMock('worker_threads',()=>({Worker:class extends EventEmitter {
    constructor(){super();this.messages=[];workers.push(this);}
    postMessage(msg){this.messages.push(msg);if(msg.type==='shutdown')this.emit('exit',0);}
  }}));
  jest.doMock('../src/utils/prodMetrics',()=>({setQueueDepthGetter(){},recordSqliteWrite(){}}));
  let writer;try {
    jest.isolateModules(()=>{writer=require('../src/db/writer');});
    const first=writer.writeAsync('A'),second=writer.writeBatch([{sql:'B',params:[]}]);writer.write('C');
    const sent=workers[0].messages.slice();workers[0].emit('exit',1);
    const fourth=writer.writeAsync('D');jest.advanceTimersByTime(500);
    const replay=workers[1].messages;
    expect(replay.map(m=>m.sql||m.ops[0].sql)).toEqual(['A','B','C','D']);
    expect(replay.slice(0,3).map(m=>m.operationId)).toEqual(sent.map(m=>m.operationId));
    for(const m of replay)workers[1].emit('message',{type:'ack',ids:[m.reqId]});
    await Promise.all([first,second,fourth]);expect(writer.backpressure.queueDepth).toBe(0);
  } finally {await writer?.shutdown();jest.useRealTimers();jest.dontMock('worker_threads');jest.dontMock('../src/utils/prodMetrics');}
});

test('shutdown during a restart waits for replay and the replacement worker exit',async()=>{
  jest.useFakeTimers();const workers=[];
  jest.doMock('worker_threads',()=>({Worker:class extends EventEmitter {
    constructor(){super();this.messages=[];workers.push(this);}
    postMessage(msg){this.messages.push(msg);if(msg.type==='shutdown')this.emit('exit',0);}
  }}));
  jest.doMock('../src/utils/prodMetrics',()=>({setQueueDepthGetter(){},recordSqliteWrite(){}}));
  let writer;try {
    jest.isolateModules(()=>{writer=require('../src/db/writer');});
    writer.write('pending');workers[0].emit('exit',1);
    const stopped=writer.shutdown();expect(writer.shutdown()).toBe(stopped);
    jest.advanceTimersByTime(500);await stopped;
    expect(workers[1].messages.map(m=>m.sql||m.type)).toEqual(['pending','shutdown']);
    jest.advanceTimersByTime(1000);expect(workers).toHaveLength(2);
  } finally {await writer?.shutdown();jest.useRealTimers();jest.dontMock('worker_threads');jest.dontMock('../src/utils/prodMetrics');}
});
