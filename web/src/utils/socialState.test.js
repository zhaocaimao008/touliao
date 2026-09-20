import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { activateSession, captureSession, invalidateSession } from './sessionContext';
import { publishSocialChange, socialRevision, socialReadCurrent, isSocialRead } from './socialState';
beforeEach(() => {
 const data=new Map();vi.stubGlobal('localStorage',{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)});
 vi.stubGlobal('sessionStorage',{getItem:()=>null});vi.stubGlobal('window',new EventTarget());invalidateSession();
});
afterEach(()=>vi.unstubAllGlobals());
test('invalidation drops old HTTP snapshots; duplicates only request truth, no stale payload values',()=>{
 activateSession('https://fixture.invalid','A');const owner=captureSession();const read={_socialRevision:socialRevision()};
 expect(socialReadCurrent(read)).toBe(true);
 expect(publishSocialChange(owner,{userId:'A',remark:'ignored'})).toBe(true);
 expect(socialReadCurrent(read)).toBe(false);
 expect(publishSocialChange(owner,{userId:'A'})).toBe(true);
 expect(socialReadCurrent({_socialRevision:socialRevision()})).toBe(true);
});
test('foreign recipient and old connection after ABA cannot invalidate new account',()=>{
 activateSession('https://fixture.invalid','A');const old=captureSession();
 expect(publishSocialChange(old,{userId:'B'})).toBe(false);
 activateSession('https://fixture.invalid','B');activateSession('https://fixture.invalid','A');
 expect(publishSocialChange(old,{userId:'A'})).toBe(false);
 expect(publishSocialChange(captureSession())).toBe(true); // reconnect
});
test('only social read responses are fenced, existing writes and message sync remain independent',()=>{
 for(const url of ['/api/users/A','/api/users/me/settings','/api/moments/notifications','/api/messages/conversations','/api/messages/conversation/group/info']) expect(isSocialRead({url})).toBe(true);
 expect(isSocialRead({url:'/api/messages/history'})).toBe(false);
 expect(isSocialRead({method:'put',url:'/api/users/profile'})).toBe(false);
});
