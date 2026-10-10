import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import { useChatComposer } from './useChatComposer';
import { useChatDrafts } from './useChatDrafts';
import { useMessageEdit } from './useMessageEdit';
import { loadDraft, listDrafts, saveDraft } from '../utils/chatDrafts';

const fixture = vi.hoisted(() => ({ storage: new Map(), unavailable: false, owner: null, revision: 1 }));
vi.mock('../utils/clientStorage', () => ({ clientStorage: {
  getItem: key => { if (fixture.unavailable) throw Error('blocked'); return fixture.storage.get(key) ?? null; },
  setItem: (key, value) => { if (fixture.unavailable) throw Error('quota'); fixture.storage.set(key, value); },
  removeItem: key => { if (fixture.unavailable) throw Error('quota'); fixture.storage.delete(key); },
  key: index => [...fixture.storage.keys()][index], get length() { return fixture.storage.size; },
} }));
vi.mock('../utils/sessionContext', () => ({
  captureSession: () => ({ ...fixture.owner, revision: fixture.revision }),
  isSessionCurrent: scope => !!fixture.owner && scope.server === fixture.owner.server && scope.accountId === fixture.owner.accountId && scope.generation === fixture.owner.generation && scope.revision === fixture.revision,
}));
let renderer, current, owner, conversationId, sequence = 0;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
function Probe({ id, account }) {
  const [compose, dispatch, storageFailed] = useChatComposer(id, account);
  const drafts = useChatDrafts(account);
  const edit = useMessageEdit(compose.editingMsg, account, saved => dispatch({ type: 'EDIT_SAVED', ...saved }));
  React.useLayoutEffect(() => { current = { compose, dispatch, drafts, storageFailed, edit }; });
  return <textarea value={compose.input} readOnly />;
}
const view = () => <Probe id={conversationId} account={owner} />;
const mount = () => act(() => { renderer = create(view()); });
const dispatch = action => act(() => current.dispatch(action));
const input = value => dispatch({ type:'SET_INPUT',value });
const editMessage = (id='message',content='Original message') => dispatch({ type:'START_EDIT',msg:{id,content} });
const remount = () => { act(() => renderer.unmount()); mount(); };
beforeEach(() => {
  owner={server:'https://one.test',accountId:'alice',generation:1}; fixture.owner=owner; fixture.revision=1;
  fixture.storage.clear(); fixture.unavailable=false; conversationId=`conversation-${++sequence}`;
  const listeners=new Map();
  vi.stubGlobal('window', {
    addEventListener: (name, listener) => { if(!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(listener); },
    removeEventListener: (name, listener) => listeners.get(name)?.delete(listener),
    dispatchEvent: event => { for(const listener of listeners.get(event.type) || []) listener(event); },
  });
  vi.stubGlobal('CustomEvent', class { constructor(type, options) { this.type=type; this.detail=options.detail; } });
  vi.spyOn(axios,'put').mockImplementation((_url,body) => Promise.resolve({data:{success:true,content:body.content}}));
});
afterEach(() => { if(renderer) act(() => renderer.unmount()); renderer=null; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('typed input persists even when navigation unmounts in the same event', () => {
  mount(); act(() => { current.dispatch({type:'SET_INPUT',value:'Keep me'}); renderer.unmount(); });
  mount(); expect(current.compose.input).toBe('Keep me'); expect(current.drafts[conversationId]).toBe('Keep me');
});
test('emoji-only drafts persist and update the conversation list', () => {
  mount(); dispatch({type:'INSERT_INPUT',text:'😀',start:0,end:0});
  expect(current.drafts[conversationId]).toBe('😀'); remount(); expect(current.compose.input).toBe('😀');
});
test('same-tick appends and mention replacements persist the final composition', () => {
  mount(); act(() => { current.dispatch({type:'APPEND_INPUT',text:'Hi '}); current.dispatch({type:'APPEND_INPUT',text:'😀'}); });
  expect(current.compose.input).toBe('Hi 😀');
  dispatch({type:'REPLACE_INPUT',value:'Hi @Alice 😀'}); remount(); expect(current.compose.input).toBe('Hi @Alice 😀');
});
test('picker insertion replaces the selection instead of always appending', () => {
  mount(); input('hello world'); dispatch({type:'INSERT_INPUT',text:'😀',start:6,end:11});
  expect(current.compose.input).toBe('hello 😀'); expect(loadDraft(conversationId,owner)).toBe('hello 😀');
});
test('picker insertion at the length limit does not split emoji or discard existing text', () => {
  mount(); input('x'.repeat(29999)); dispatch({type:'INSERT_INPUT',text:'😀',start:29999,end:29999});
  expect(current.compose.input).toHaveLength(29999);
  dispatch({type:'INSERT_INPUT',text:'😀',start:29998,end:29999}); expect(current.compose.input).toHaveLength(30000);
  expect(current.compose.input.endsWith('😀')).toBe(true);
});
test('editing and cancelling restores the original draft and reply without persisting edit text', () => {
  mount(); input('Unsent draft'); dispatch({type:'SET_REPLY',msg:{id:'reply'}}); editMessage(); input('Edited text');
  expect(loadDraft(conversationId,owner)).toBe('Unsent draft'); expect(current.drafts[conversationId]).toBe('Unsent draft');
  dispatch({type:'CANCEL_EDIT'}); expect(current.compose.input).toBe('Unsent draft'); expect(current.compose.replyTo.id).toBe('reply');
});
test('switching between edited messages preserves the original composition', () => {
  mount(); input('Draft'); editMessage('one'); input('Changed one'); editMessage('two'); input('Changed two');
  dispatch({type:'CANCEL_EDIT'}); expect(current.compose.input).toBe('Draft');
});
test('replying during an edit restores the draft instead of sending the edited message as new text', () => {
  mount(); input('Draft'); editMessage(); input('Edited'); dispatch({type:'SET_REPLY',msg:{id:'new-reply'}});
  expect(current.compose.input).toBe('Draft'); expect(current.compose.replyTo.id).toBe('new-reply');
});
test('send clears persisted draft and list preview', () => {
  mount(); input('Ready'); dispatch({type:'SENT'}); remount(); expect(current.compose.input).toBe(''); expect(current.drafts[conversationId]).toBeUndefined();
});
test('a scheduled-message callback only consumes the same, non-editing draft', () => {
  mount(); input('New draft'); dispatch({type:'CONSUMED_DRAFT',content:'Old draft'}); expect(current.compose.input).toBe('New draft');
  editMessage(); dispatch({type:'CONSUMED_DRAFT',content:'Original message'}); expect(current.compose.editingMsg).not.toBeNull();
  dispatch({type:'CANCEL_EDIT'}); dispatch({type:'CONSUMED_DRAFT',content:'New draft'}); expect(loadDraft(conversationId,owner)).toBe('');
});
test.each(['account','server'])('drafts for a shared conversation are isolated by %s', mode => {
  mount(); input('Private to Alice'); const firstOwner=owner;
  owner={...owner, [mode==='account'?'accountId':'server']:mode==='account'?'bob':'https://two.test',generation:2}; fixture.owner=owner;
  act(() => renderer.update(view())); expect(current.compose.input).toBe(''); expect(current.drafts).toEqual({});
  input('Other draft'); expect(loadDraft(conversationId,firstOwner)).toBe('Private to Alice');
});
test('legacy unowned drafts are kept on disk but never attributed to the current account', () => {
  fixture.storage.set(`draft_${conversationId}`,'Unknown owner'); mount();
  expect(current.compose.input).toBe(''); expect(current.drafts).toEqual({}); expect(fixture.storage.get(`draft_${conversationId}`)).toBe('Unknown owner');
});
test('stale callbacks cannot overwrite the draft after leaving and returning to a conversation', () => {
  mount(); input('A'); const stale=current.dispatch; const first=conversationId;
  conversationId='other'; act(() => renderer.update(view())); conversationId=first; act(() => renderer.update(view()));
  act(() => stale({type:'SET_INPUT',value:'Stale'})); expect(current.compose.input).toBe('A'); expect(loadDraft(first,owner)).toBe('A');
});
test('foreign and unowned draft events cannot leak into the current list', () => {
  mount(); act(() => window.dispatchEvent(new CustomEvent('draft-changed',{detail:{convId:conversationId,text:'Foreign',owner:'wrong'}})));
  expect(current.drafts).toEqual({});
});
test('cross-window storage changes refresh the list without replacing a draft being composed', () => {
  mount(); input('Writing here');
  fixture.storage.set('draft_v2_'+JSON.stringify([owner.server,owner.accountId,conversationId]),'Other window');
  act(() => window.dispatchEvent({type:'storage'}));
  expect(current.drafts[conversationId]).toBe('Other window'); expect(current.compose.input).toBe('Writing here');
});
test('storage failure retains input, list preview and a warning across conversation remounts', () => {
  mount(); fixture.unavailable=true; input('Still here'); expect(current.storageFailed).toBe(true);
  expect(current.drafts[conversationId]).toBe('Still here'); remount(); expect(current.compose.input).toBe('Still here'); expect(current.storageFailed).toBe(true);
  fixture.unavailable=false; input('Stored again'); expect(current.storageFailed).toBe(false); expect(loadDraft(conversationId,owner)).toBe('Stored again');
});
test('a failed clear masks an older stored draft within the page', () => {
  mount(); input('Old text'); fixture.unavailable=true; dispatch({type:'SENT'}); fixture.unavailable=false;
  remount(); expect(current.compose.input).toBe(''); expect(listDrafts(owner)).toEqual({});
});
test('corrupt scoped keys do not break list loading', () => {
  fixture.storage.set('draft_v2_invalid','oops'); fixture.storage.set('draft_v2_{}','oops'); mount(); expect(current.drafts).toEqual({});
});
test('a draft without an account owner is not stored or published', () => {
  mount(); expect(saveDraft(conversationId,'Unowned',null)).toBe(false);
  expect(fixture.storage.size).toBe(0); expect(current.drafts).toEqual({});
});
test('message edit saves serialize and restore the original draft after acknowledgement', async () => {
  mount(); input('Original draft'); editMessage(); input('New message'); const response=deferred(); axios.put.mockReturnValueOnce(response.promise);
  let task; act(() => { task=current.edit.save(current.compose.input); current.edit.save(current.compose.input); });
  expect(axios.put).toHaveBeenCalledTimes(1); expect(current.edit.saving).toBe(true);
  expect(axios.put.mock.calls[0][2]._sessionContext.accountId).toBe('alice');
  await act(async () => { response.resolve({data:{success:true,content:'New message'}}); await task; });
  expect(current.compose.editingMsg).toBeNull(); expect(current.compose.input).toBe('Original draft');
});
test.each([{success:false},{success:true},{success:true,content:'Different'}])('an invalid edit acknowledgement keeps changes and permits retry: %j', async data => {
  mount(); editMessage(); input('New message'); axios.put.mockResolvedValueOnce({data});
  await act(async () => current.edit.save(current.compose.input)); expect(current.edit.error).toBe(true); expect(current.compose.input).toBe('New message');
  await act(async () => current.edit.save(current.compose.input)); expect(current.compose.editingMsg).toBeNull();
});
test('edit refusal is visible and does not discard the edit', async () => {
  mount(); editMessage(); input('New message'); axios.put.mockRejectedValueOnce({response:{data:{error:'No longer a member'}}});
  await act(async () => current.edit.save(current.compose.input)); expect(current.edit.detail).toBe('No longer a member'); expect(current.compose.input).toBe('New message');
});
test('cancelling a pending edit aborts it and its late acknowledgement cannot clear a new draft', async () => {
  mount(); input('Draft'); editMessage(); input('New message'); const response=deferred(); axios.put.mockReturnValueOnce(response.promise);
  let task; act(() => { task=current.edit.save(current.compose.input); }); const signal=axios.put.mock.calls[0][2].signal;
  dispatch({type:'CANCEL_EDIT'}); input('Later draft'); expect(signal.aborted).toBe(true);
  await act(async () => { response.resolve({data:{success:true,content:'New message'}}); await task; });
  expect(current.compose.input).toBe('Later draft'); expect(current.edit.saving).toBe(false);
});
test('same-message leave and reopen rejects the older save completion', async () => {
  mount(); editMessage(); input('First edit'); const response=deferred(); axios.put.mockReturnValueOnce(response.promise);
  let task; act(() => { task=current.edit.save(current.compose.input); });
  dispatch({type:'CANCEL_EDIT'}); editMessage(); input('Second edit');
  await act(async () => { response.resolve({data:{success:true,content:'First edit'}}); await task; });
  expect(current.compose.input).toBe('Second edit'); expect(current.compose.editingMsg).not.toBeNull();
});
test('an account or credential change invalidates a pending edit acknowledgement', async () => {
  mount(); editMessage(); input('New message'); const response=deferred(); axios.put.mockReturnValueOnce(response.promise);
  let task; act(() => { task=current.edit.save(current.compose.input); }); fixture.revision++;
  await act(async () => { response.resolve({data:{success:true,content:'New message'}}); await task; });
  expect(current.compose.editingMsg).not.toBeNull(); expect(current.compose.input).toBe('New message');
  expect(current.edit.saving).toBe(false); expect(current.edit.error).toBe(true);
});
test('a stale editor callback cannot submit using a newly activated account', async () => {
  mount(); editMessage(); fixture.owner={...owner,accountId:'bob',generation:2};
  await act(async () => current.edit.save('No')); expect(axios.put).not.toHaveBeenCalled();
});
test('acknowledging an earlier input cannot discard a newer edit value', async () => {
  mount(); editMessage(); input('First edit'); const response=deferred(); axios.put.mockReturnValueOnce(response.promise);
  let task; act(() => { task=current.edit.save(current.compose.input); }); input('Second edit');
  await act(async () => { response.resolve({data:{success:true,content:'First edit'}}); await task; });
  expect(current.compose.input).toBe('Second edit'); expect(current.compose.editingMsg).not.toBeNull();
});
