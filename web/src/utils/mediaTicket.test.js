import { beforeEach, afterEach, expect, test, vi } from 'vitest';
function storage() {
  const values = new Map();
  return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,String(v)),
    removeItem:k=>values.delete(k),key:i=>[...values.keys()][i]??null,get length(){return values.size;} };
}
let mediaUrl, resolveMediaUrl, invalidateMediaTickets, minted;
const file='/uploads/files/q02.txt', root='https://media.example';
const response = (serial=++minted, path=file) => ({ok:true,json:async()=>({url:`${path}?token=h.${btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+30,serial}))}.s`})});
beforeEach(async()=>{
  vi.resetModules(); const target=new EventTarget(); target.__ELECTRON_CONFIG__={};
  vi.stubGlobal('window',target); vi.stubGlobal('localStorage',storage()); vi.stubGlobal('sessionStorage',storage());
  localStorage.setItem('touliao_server_url',root);localStorage.setItem('touliao_electron_token','credential-A');
  minted=0;vi.stubGlobal('fetch',vi.fn(async()=>response()));
  ({mediaUrl,resolveMediaUrl,invalidateMediaTickets}=await import('./url'));
});
afterEach(()=>{invalidateMediaTickets();vi.useRealTimers();vi.unstubAllGlobals();});
test('render does not wait; concurrent requests deduplicate and cache until credential changes',async()=>{
  expect(mediaUrl(file)).toBeUndefined();expect(mediaUrl(file)).toBeUndefined();
  const [a,b]=await Promise.all([resolveMediaUrl(file),resolveMediaUrl(file)]);
  expect(a).toBe(b);expect(mediaUrl(file)).toBe(a);expect(minted).toBe(1);
  localStorage.setItem('touliao_electron_token','credential-B');expect(await resolveMediaUrl(file)).not.toBe(a);expect(minted).toBe(2);
});
test('legacy session cache ignored; absolute local paths signed, external URLs untouched',async()=>{
  sessionStorage.setItem(`touliao_media_ticket:${file}`,JSON.stringify({url:file+'?token=legacy',expiresAt:Date.now()+500000}));
  expect(await resolveMediaUrl(root+file)).not.toContain('legacy');
  expect(mediaUrl('https://external.example'+file)).toBe('https://external.example'+file);expect(minted).toBe(1);
});
test('server change cannot reuse tickets',async()=>{
  const first=await resolveMediaUrl(file);localStorage.setItem('touliao_server_url','https://other.example');
  expect((await resolveMediaUrl(file)).replace('https://other.example',root)).not.toBe(first);
});
test('credential event invalidates even unchanged token (ABA)',async()=>{
  const first=await resolveMediaUrl(file);window.dispatchEvent(new Event('touliao:credentials-updated'));
  expect(await resolveMediaUrl(file)).not.toBe(first);
});
test('late response cannot return authority after logout/account switch',async()=>{
  let finish;fetch.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
  const old=resolveMediaUrl(file);const rejected=expect(old).rejects.toThrow('媒体授权失败');
  localStorage.setItem('touliao_electron_token','credential-B');const fresh=await resolveMediaUrl(file);
  finish(response());await rejected;expect(mediaUrl(file)).toBe(fresh);
});
test('logout fails closed, next login gets a fresh ticket',async()=>{
  const first=await resolveMediaUrl(file);localStorage.removeItem('touliao_electron_token');
  expect(mediaUrl(file)).toBe(root+file+'?token=unavailable');
  localStorage.setItem('touliao_electron_token','credential-A');expect(await resolveMediaUrl(file)).not.toBe(first);
});
test('expired ticket renewed',async()=>{
  vi.useFakeTimers();const first=await resolveMediaUrl(file);await vi.advanceTimersByTimeAsync(31000);
  expect(await resolveMediaUrl(file)).not.toBe(first);
});
test('failed ticket has render cooldown but explicit download can retry immediately',async()=>{
  fetch.mockResolvedValueOnce({ok:false,status:401});await expect(resolveMediaUrl(file)).rejects.toThrow();
  expect(mediaUrl(file)).toBe(root+file+'?token=unavailable');expect(fetch).toHaveBeenCalledTimes(1);
  expect(await resolveMediaUrl(file)).toContain('?token=h.');expect(fetch).toHaveBeenCalledTimes(2);
});
test('isolated browser uses its own bearer and fails closed',async()=>{
  delete window.__ELECTRON_CONFIG__;window.location={origin:root};sessionStorage.setItem('touliao_account_window','independent-window');
  sessionStorage.setItem('touliao_electron_token','isolated-B');fetch.mockResolvedValueOnce({ok:false,status:401});
  await expect(resolveMediaUrl(file)).rejects.toThrow();
  expect(fetch.mock.calls[0][1].headers).toEqual({Authorization:'Bearer isolated-B','X-Touliao-Session':'isolated'});
  expect(mediaUrl(file)).toBe(root+file+'?token=unavailable');
});
test('rejects tickets for an unrelated file or server',async()=>{
  for(const path of ['/uploads/wrong.txt','https://evil.example'+file]){
    fetch.mockResolvedValueOnce(response(undefined,path));await expect(resolveMediaUrl(file)).rejects.toThrow();
  }
});
test('ticket timeout aborts a stalled network request and permits retry',async()=>{
  vi.useFakeTimers();fetch.mockImplementationOnce((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))));
  const pending=expect(resolveMediaUrl(file)).rejects.toThrow();await vi.advanceTimersByTimeAsync(10001);await pending;
  expect(await resolveMediaUrl(file)).toContain('?token=h.');
});
