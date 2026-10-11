import { afterEach, expect, test, vi } from 'vitest';
import { startPagedSearchTask } from './pagedSearchTask';
const rows = (...ids) => ids.map(id=>({id}));
const deferred = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
let task;
afterEach(()=>{task?.cancel();task=null;vi.useRealTimers();});
async function start(load,options={}) {
  vi.useFakeTimers(); const updates=[];
  task=startPagedSearchTask({key:'query',query:'hello',load,onState:state=>updates.push(state),pageSize:2,...options});
  await vi.runOnlyPendingTimersAsync(); return updates;
}
test('loads successive pages with accurate totals and deduplicates overlap',async()=>{
  const load=vi.fn().mockResolvedValueOnce({results:rows(3,2),total:4}).mockResolvedValueOnce({results:rows(2,1),total:4});
  const states=await start(load); expect(states.at(-1)).toMatchObject({data:rows(3,2),total:4,hasMore:true});
  await task.loadMore(); expect(load.mock.calls[1].slice(2)).toEqual([2,2]);
  expect(states.at(-1)).toMatchObject({data:rows(3,2,1),hasMore:false,offset:4});
});
test('deduplicates rapid load-more activation synchronously',async()=>{
  const next=deferred(); const load=vi.fn().mockResolvedValueOnce(rows(3,2)).mockReturnValue(next.promise);
  await start(load); const request=task.loadMore(); task.loadMore(); task.loadMore();
  expect(load).toHaveBeenCalledTimes(2); next.resolve(rows(1)); await request;
});
test('a failed later page preserves results and retries exactly the failed offset',async()=>{
  const load=vi.fn().mockResolvedValueOnce(rows(3,2)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(rows(1));
  const states=await start(load); await task.loadMore(); expect(states.at(-1)).toMatchObject({data:rows(3,2),moreError:true,status:'success',hasMore:true});
  await task.loadMore(); expect(load.mock.calls.slice(1).map(call=>call[2])).toEqual([2,2]);
  expect(states.at(-1)).toMatchObject({data:rows(3,2,1),moreError:false,hasMore:false});
});
test('cancelled queries abort in-flight requests and ignore late responses',async()=>{
  const pending=deferred(); const load=vi.fn().mockReturnValue(pending.promise); const states=await start(load);
  const count=states.length; task.cancel(); expect(load.mock.calls[0][1].aborted).toBe(true);
  pending.resolve(rows(1)); await Promise.resolve(); expect(states).toHaveLength(count);
});
test('empty queries and replacement during debounce make no request',async()=>{
  const load=vi.fn(); await start(load,{query:'  '}); expect(load).not.toHaveBeenCalled();
  task=startPagedSearchTask({key:'q',query:'hello',load,onState:()=>{},delay:300});task.cancel();await vi.runOnlyPendingTimersAsync();expect(load).not.toHaveBeenCalled();
});
test('malformed initial payload shows an error rather than a false empty result',async()=>{
  const states=await start(vi.fn().mockResolvedValue({results:null}));expect(states.at(-1).status).toBe('error');
});
test('empty and repeated pages stop pagination without an endless request loop',async()=>{
  const load=vi.fn().mockResolvedValueOnce(rows(2,1)).mockResolvedValueOnce(rows(2,1)); const states=await start(load);
  await task.loadMore();expect(states.at(-1).hasMore).toBe(false);task.loadMore();expect(load).toHaveBeenCalledTimes(2);
});
test('reaching the server pagination cap requests narrower criteria instead of looping',async()=>{
  const states=await start(vi.fn().mockResolvedValue({results:rows(2,1),total:10}),{maxOffset:2});
  expect(states.at(-1)).toMatchObject({limited:true,hasMore:false});
});
