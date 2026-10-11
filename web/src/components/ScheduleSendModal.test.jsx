import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import axios from 'axios';
import ScheduleSendModal from './ScheduleSendModal';
import { toScheduleLocal, datetimeLocalToUnix } from '../utils/scheduleSend';

const fixture=vi.hoisted(()=>({owner:null,revision:1,focus:null}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({outboxScope:fixture.owner})}));
vi.mock('../contexts/I18nContext',()=>({useI18n:()=>({t:key=>key,lang:'zh-CN'})}));
vi.mock('../hooks/useFocusTrap',()=>({default:(_active,options)=>{fixture.focus=options;return {current:null};}}));
vi.mock('react-dom',()=>({createPortal:child=>child}));
vi.mock('../utils/sessionContext',()=>({captureSession:()=>({...fixture.owner,revision:fixture.revision}),isSessionCurrent:scope=>scope.accountId===fixture.owner.accountId&&scope.server===fixture.owner.server&&scope.generation===fixture.owner.generation&&scope.revision===fixture.revision}));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
let renderer,props,get,post,remove;
const field=id=>renderer.root.findByProps({'data-testid':id});
const button=label=>renderer.root.findAllByType('button').find(node=>node.props.children===label);
const change=(id,value)=>act(()=>field(id).props.onChange({target:{value}}));
const submit=()=>renderer.root.findByType('form').props.onSubmit({preventDefault(){}});
const mount=async()=>act(async()=>{renderer=create(<ScheduleSendModal {...props}/>);});
const update=async()=>act(async()=>renderer.update(<ScheduleSendModal {...props}/>));
const text=node=>typeof node==='string'?node:(node?.children||[]).map(text).join('');
const task=(overrides={})=>({id:'one',conversation_id:'chat',sender_id:'alice',status:'pending',type:'text',content:'Scheduled text',send_at:Math.floor(Date.now()/1000)+3600,...overrides});
const success=body=>({data:{success:true,scheduled:task({...body,id:'created'})}});
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2030-06-01T10:00:20Z'));
  fixture.owner={server:'https://one.test',accountId:'alice',generation:1};fixture.revision=1;
  vi.stubGlobal('document',{body:{}});
  get=vi.spyOn(axios,'get').mockResolvedValue({data:[]});
  post=vi.spyOn(axios,'post').mockImplementation((_url,body)=>Promise.resolve(success(body)));
  remove=vi.spyOn(axios,'delete').mockResolvedValue({data:{success:true}});
  props={convId:'chat',defaultContent:'Original draft',onClose:vi.fn(),onScheduled:vi.fn()};
});
afterEach(()=>{if(renderer)act(()=>renderer.unmount());renderer=null;vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

test('double submit posts once and consumes only the confirmed normalized content',async()=>{
  const request=deferred();post.mockReturnValue(request.promise);await mount();change('schedule-content','  Edited draft  ');
  act(()=>{submit();submit();});expect(post).toHaveBeenCalledTimes(1);expect(field('schedule-content').props.disabled).toBe(true);expect(field('schedule-time').props.disabled).toBe(true);
  const body=post.mock.calls[0][1];await act(async()=>request.resolve(success(body)));
  expect(props.onScheduled).toHaveBeenCalledWith('Edited draft');expect(post.mock.calls[0][2]).toMatchObject({skipRetry:true,_sessionContext:{accountId:'alice'}});
  act(()=>submit());expect(post).toHaveBeenCalledTimes(1);
});
test('saving blocks backdrop, Escape and cancel handlers even before rerender',async()=>{
  const request=deferred();post.mockReturnValue(request.promise);await mount();const overlay=renderer.root.findByProps({className:'schedule-overlay'}),cancel=button('common.cancel');
  act(()=>{submit();const target={};overlay.props.onClick({target,currentTarget:target});cancel.props.onClick();fixture.focus.onEscape();});
  expect(props.onClose).not.toHaveBeenCalled();await act(async()=>request.resolve(success(post.mock.calls[0][1])));
});
test('idle backdrop and Escape close without scheduling',async()=>{
  await mount();const target={};act(()=>renderer.root.findByProps({className:'schedule-overlay'}).props.onClick({target,currentTarget:target}));
  act(()=>fixture.focus.onEscape());expect(props.onClose).toHaveBeenCalledTimes(2);expect(post).not.toHaveBeenCalled();
});
test.each(['','not-a-date','2030-02-31T10:20'])('invalid time %s never sends a request',async value=>{
  await mount();change('schedule-time',value);await act(async()=>submit());expect(post).not.toHaveBeenCalled();expect(field('schedule-time').props['aria-invalid']).toBe(true);expect(text(renderer.root)).toContain('ss.errInvalidTime');
});
test('an expired selected time is not silently moved forward',async()=>{
  await mount();const chosen=toScheduleLocal(new Date(Date.now()+16*60*1000));change('schedule-time',chosen);vi.advanceTimersByTime(3*60*1000);
  await act(async()=>submit());expect(post).not.toHaveBeenCalled();expect(field('schedule-time').props.value).toBe(chosen);expect(text(renderer.root)).toContain('ss.errTooSoon');
  act(()=>button('ss.useEarliest').props.onClick());expect(datetimeLocalToUnix(field('schedule-time').props.value)-Date.now()/1000).toBeGreaterThanOrEqual(15*60);
  await act(async()=>submit());expect(post).toHaveBeenCalledTimes(1);
});
test('too-far time and empty message are validated before transmission',async()=>{
  await mount();change('schedule-time',toScheduleLocal(new Date(Date.now()+31*86400000)));await act(async()=>submit());expect(text(renderer.root)).toContain('ss.errTooFar');
  change('schedule-content','   ');await act(async()=>submit());expect(text(renderer.root)).toContain('ss.errEmptyContent');expect(post).not.toHaveBeenCalled();
});
test('a definitive server rejection retains edited input and permits retry',async()=>{
  post.mockRejectedValueOnce({response:{status:400,data:{error:'Time rejected'}}});await mount();change('schedule-content','Keep this');
  await act(async()=>submit());expect(text(renderer.root)).toContain('Time rejected');expect(field('schedule-content').props.value).toBe('Keep this');expect(props.onScheduled).not.toHaveBeenCalled();
  await act(async()=>submit());expect(post).toHaveBeenCalledTimes(2);expect(props.onScheduled).toHaveBeenCalledWith('Keep this');
});
test('an ambiguous failure refreshes tasks and blocks retry until reviewed',async()=>{
  post.mockRejectedValueOnce(Error('lost response'));await mount();await act(async()=>submit());
  expect(text(renderer.root)).toContain('ss.resultUnconfirmed');expect(get).toHaveBeenCalledTimes(2);expect(button('ss.confirmSend').props.disabled).toBe(true);
  await act(async()=>submit());expect(post).toHaveBeenCalledTimes(1);
  act(()=>button('ss.reviewed').props.onClick());await act(async()=>submit());expect(post).toHaveBeenCalledTimes(2);
});
test('failed list refresh cannot dismiss an ambiguous-create warning',async()=>{
  await mount();get.mockRejectedValue(Error('offline'));post.mockRejectedValue(Error('offline'));await act(async()=>submit());
  expect(button('ss.reviewed').props.disabled).toBe(true);act(()=>button('ss.reviewed').props.onClick());await act(async()=>submit());expect(post).toHaveBeenCalledTimes(1);
});
test.each(['conversation_id','sender_id','content','send_at','status'])('mismatched server %s cannot clear a draft',async fieldName=>{
  post.mockImplementation((_url,body)=>Promise.resolve({data:{success:true,scheduled:task({...body,[fieldName]:'wrong'})}}));await mount();await act(async()=>submit());
  expect(props.onScheduled).not.toHaveBeenCalled();expect(text(renderer.root)).toContain('ss.resultUnconfirmed');
});
test.each(['conversation','account','server'])('switching %s invalidates a late create result',async mode=>{
  const request=deferred();post.mockReturnValue(request.promise);await mount();act(()=>submit());const body=post.mock.calls[0][1],config=post.mock.calls[0][2];
  if(mode==='conversation')props={...props,convId:'other'};else fixture.owner={...fixture.owner,[mode==='account'?'accountId':'server']:'other'};
  await update();expect(config.signal.aborted).toBe(true);await act(async()=>request.resolve(success(body)));expect(props.onScheduled).not.toHaveBeenCalled();
});
test('credential revision invalidation unlocks form but does not consume the draft',async()=>{
  const request=deferred();post.mockReturnValue(request.promise);await mount();act(()=>submit());fixture.revision++;
  await act(async()=>request.resolve(success(post.mock.calls[0][1])));expect(props.onScheduled).not.toHaveBeenCalled();expect(field('schedule-content').props.disabled).toBe(false);expect(text(renderer.root)).toContain('ss.resultUnconfirmed');
});
test('unmount aborts list and creation requests and ignores their late completion',async()=>{
  const list=deferred(),request=deferred();get.mockReturnValue(list.promise);post.mockReturnValue(request.promise);await mount();act(()=>submit());
  const config=get.mock.calls[0][1],body=post.mock.calls[0][1],createConfig=post.mock.calls[0][2];act(()=>renderer.unmount());
  expect(config.signal.aborted).toBe(true);expect(createConfig.signal.aborted).toBe(true);await act(async()=>{list.resolve({data:[task()]});request.resolve(success(body));});expect(props.onScheduled).not.toHaveBeenCalled();
});
test('list includes only this account and conversation with separate recovery feedback',async()=>{
  get.mockResolvedValue({data:[task(),task({id:'recovery',status:'recovery_required'}),task({id:'other-chat',conversation_id:'other',content:'Secret chat'}),task({id:'other-user',sender_id:'bob',content:'Secret user'})]});await mount();
  expect(renderer.root.findAllByProps({className:'schedule-task-content'})).toHaveLength(2);expect(text(renderer.root)).not.toContain('Secret');expect(text(renderer.root)).toContain('ss.recoveryHint');
});
test('failed or malformed list is distinct from an empty result',async()=>{
  get.mockResolvedValue({data:{tasks:[]}});await mount();expect(text(renderer.root)).toContain('ss.loadFailed');expect(text(renderer.root)).not.toContain('ss.noPending');
});
test('cancelling a task locks duplicate cancellation and creation until confirmed',async()=>{
  get.mockResolvedValue({data:[task()]});const request=deferred();remove.mockReturnValue(request.promise);await mount();const cancel=button('ss.cancelTask');
  act(()=>{cancel.props.onClick();cancel.props.onClick();submit();});expect(remove).toHaveBeenCalledTimes(1);expect(post).not.toHaveBeenCalled();
  await act(async()=>request.resolve({data:{success:true}}));expect(renderer.root.findAllByProps({className:'schedule-task-content'})).toHaveLength(0);
});
test('failed cancellation keeps the task visible and refreshes authoritative state',async()=>{
  get.mockResolvedValue({data:[task()]});remove.mockRejectedValue(Error('lost response'));await mount();await act(async()=>button('ss.cancelTask').props.onClick());
  expect(text(renderer.root)).toContain('ss.cancelFailed');expect(renderer.root.findAllByProps({className:'schedule-task-content'})).toHaveLength(1);expect(get).toHaveBeenCalledTimes(2);
});
test('a late list requested before cancellation cannot resurrect the removed task',async()=>{
  get.mockResolvedValue({data:[task()]});await mount();const list=deferred();get.mockReturnValue(list.promise);act(()=>{button('ss.refresh').props.onClick();});
  // The button disappears while loading, but an already-queued activation may still arrive.
  const request=deferred();remove.mockReturnValue(request.promise);
  list.resolve({data:[task()]});await act(async()=>{});
  const cancel=button('ss.cancelTask');act(()=>{cancel.props.onClick();});
  // Refresh uses an independent read channel; its old response is invalidated by confirmation.
  const list2=deferred();get.mockReturnValue(list2.promise);act(()=>{button('ss.refresh').props.onClick();});
  await act(async()=>request.resolve({data:{success:true}}));await act(async()=>list2.resolve({data:[task()]}));
  expect(renderer.root.findAllByProps({className:'schedule-task-content'})).toHaveLength(0);
});
