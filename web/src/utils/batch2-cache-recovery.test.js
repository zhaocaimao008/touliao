import { test, expect, vi, afterEach } from 'vitest';
import { catchUpConversation, applySyncEvents } from './messageSync';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
test('without IndexedDB, history initialization and paged sync keep running; reconnect replays from zero', async () => {
 vi.resetModules(); vi.stubGlobal('indexedDB', undefined);
 const cache=await import('./msgCache');
 let current=[{id:'old',content:'old-secret',server_sequence:1}],historyReady=false;
 await cache.saveCache('conv',current,{strict:true});historyReady=true;
 expect(historyReady).toBe(true);
 const requested=[];
 const sync=()=>catchUpConversation({conversationId:'conv',accountId:'user',isCurrent:()=>true,
  loadCursor:cache.loadSyncCursor,saveCursor:cache.saveSyncCursor,
  requestPage:async (_conv,cursor)=>{requested.push(cursor);return cursor===0
   ?{messages:[{event_type:'conversation_cleared',server_sequence:2,payload:{}}],next_cursor:2,has_more:true}
   :{messages:[{event_type:'message_created',message_id:'new',server_sequence:3,message:{id:'new',content:'new',server_sequence:3}}],next_cursor:3,has_more:false}},
  applyPage:async events=>{await cache.saveCache('conv',[],{strict:true});current=applySyncEvents(current,events)},
 });
 expect(await sync()).toBe(3);expect(current.map(m=>m.id)).toEqual(['new']);
 expect(await cache.loadSyncCursor('user','conv')).toBe(0);
 await sync();expect(requested).toEqual([0,2,0,2]);expect(current.map(m=>m.id)).toEqual(['new']);
});
test('network loss between pages retains committed cursor and retry applies vanished once',async()=>{
 let cursor=0,current=[{id:'burn',server_sequence:1,burn_after:60}],disconnect=true;
 const requests=[];
 const run=()=>catchUpConversation({conversationId:'conv',accountId:'user',isCurrent:()=>true,
  loadCursor:async()=>cursor,saveCursor:async(_a,_c,n)=>{cursor=n},
  requestPage:async(_c,n)=>{requests.push(n);if(n===0)return{messages:[],next_cursor:1,has_more:true};if(disconnect)throw Error('offline');return{messages:[{event_type:'message_vanished',message_id:'burn',server_sequence:2}],next_cursor:2,has_more:false}},
  applyPage:async events=>{current=applySyncEvents(current,events)},
 });
 await expect(run()).rejects.toThrow('offline');expect(cursor).toBe(1);expect(current).toHaveLength(1);
 disconnect=false;await run();expect(cursor).toBe(2);expect(current).toEqual([]);expect(requests).toEqual([0,1,1]);
});
test('real IndexedDB transaction abort rejects strict clear and prevents cursor advancement; retry commits',async()=>{
 vi.resetModules();const {indexedDB,IDBObjectStore}=await import('fake-indexeddb');vi.stubGlobal('indexedDB',indexedDB);
 const cache=await import('./msgCache');await cache.saveCache('abort-conv',[{id:'old',content:'stale'}]);await cache.saveSyncCursor('abort-user','abort-conv',1);
 const original=IDBObjectStore.prototype.delete;
 const fault=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(key){const result=original.call(this,key);this.transaction.abort();return result});
 const run=()=>catchUpConversation({conversationId:'abort-conv',accountId:'abort-user',isCurrent:()=>true,
 loadCursor:cache.loadSyncCursor,saveCursor:cache.saveSyncCursor,
 requestPage:async()=>({messages:[{event_type:'conversation_cleared',server_sequence:2}],next_cursor:2,has_more:false}),
 applyPage:async()=>cache.saveCache('abort-conv',[],{strict:true})});
 await expect(run()).rejects.toThrow();expect(await cache.loadSyncCursor('abort-user','abort-conv')).toBe(1);expect(await cache.loadCache('abort-conv')).toHaveLength(1);
 fault.mockRestore();await run();expect(await cache.loadSyncCursor('abort-user','abort-conv')).toBe(2);expect(await cache.loadCache('abort-conv')).toEqual([]);
});
