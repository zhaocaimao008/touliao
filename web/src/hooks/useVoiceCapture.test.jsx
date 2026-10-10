import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useVoiceCapture } from './useVoiceCapture';
import VoiceRecordButton from '../components/VoiceRecordButton';

const fixture = vi.hoisted(() => ({ owner: null, revision: 1 }));
vi.mock('../utils/sessionContext', () => ({
  captureSession: () => ({ ...fixture.owner, revision: fixture.revision }),
  isSessionCurrent: scope => scope.server === fixture.owner.server && scope.accountId === fixture.owner.accountId && scope.generation === fixture.owner.generation && scope.revision === fixture.revision,
}));
vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
let renderer, capture, props, permission, recorder, stream, onReady, onError, windowEvents, documentEvents;
class Recorder {
  static isTypeSupported() { return true; }
  constructor() { recorder=this; this.state='inactive'; this.mimeType='audio/webm'; this.stop=vi.fn(()=>{this.state='inactive';}); }
  start() { this.state='recording'; }
  deliver() { this.ondataavailable?.({data:new Blob(['a'.repeat(2000)],{type:'audio/webm'})}); return this.onstop?.(); }
}
function Probe(options) { const value=useVoiceCapture(options); React.useLayoutEffect(()=>{capture=value;}); return <VoiceRecordButton capture={value} />; }
const render = () => act(()=>{renderer=create(<Probe {...props} />);});
const refresh = () => act(()=>renderer.update(<Probe {...props} />));
const begin = async () => { let result; act(()=>{result=capture.start();}); permission.resolve(stream); await act(async()=>{await result;}); };
const button = () => renderer.root.findByProps({'data-testid':'chat-voice-btn'});
const events = () => { const listeners=new Map(); return {
  addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),
  fire:(type,event={})=>{for(const fn of listeners.get(type)||[])fn(event);},
}; };
beforeEach(()=>{
  vi.useFakeTimers(); vi.setSystemTime(10000);
  fixture.owner={server:'https://one.test',accountId:'a',generation:1};fixture.revision=1;
  permission=deferred(); stream={getTracks:()=>[stream.track],track:{stop:vi.fn()}};
  windowEvents=events();documentEvents={...events(),visibilityState:'visible'};
  vi.stubGlobal('window',windowEvents);vi.stubGlobal('document',documentEvents);
  vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn(()=>permission.promise)}});
  vi.stubGlobal('MediaRecorder',Recorder); recorder=null;
  onReady=vi.fn();onError=vi.fn();
  props={conversationId:'one',owner:fixture.owner,enabled:true,onReady,onError}; render();
});
afterEach(()=>{if(renderer)act(()=>renderer.unmount());renderer=null;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

test('normal release sends one recording and closes microphone tracks',async()=>{
  await begin();expect(capture.phase).toBe('recording');vi.advanceTimersByTime(1500);
  act(()=>{capture.finish();capture.finish();});expect(recorder.stop).toHaveBeenCalledTimes(1);
  await act(async()=>{await recorder.deliver();});
  expect(onReady).toHaveBeenCalledTimes(1);expect(onReady.mock.calls[0][0].filename).toBe('voice.webm');
  expect(stream.track.stop).toHaveBeenCalled();expect(capture.phase).toBe('idle');
});
test('release before microphone permission resolves never starts recording',async()=>{
  let pending;act(()=>{pending=capture.start();});expect(capture.phase).toBe('requesting');
  act(()=>capture.finish());permission.resolve(stream);await act(async()=>pending);
  expect(recorder).toBeNull();expect(stream.track.stop).toHaveBeenCalled();expect(onReady).not.toHaveBeenCalled();
});
test('double start cannot create two microphone requests',async()=>{
  act(()=>{capture.start();capture.start();});expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  permission.resolve(stream);await act(async()=>{});expect(capture.phase).toBe('recording');
});
test('a busy upload is reported before requesting the microphone',async()=>{
  const canStart=vi.fn(()=>false);props={...props,canStart};refresh();await act(async()=>capture.start());
  expect(canStart).toHaveBeenCalledTimes(1);expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();expect(capture.phase).toBe('idle');
});
test('cancel discards queued recorder events',async()=>{
  await begin();const lateStop=recorder.onstop;act(()=>capture.cancel());await act(async()=>lateStop());
  expect(onReady).not.toHaveBeenCalled();expect(capture.phase).toBe('idle');expect(stream.track.stop).toHaveBeenCalled();
});
test('unmount stops recording without delivering it',async()=>{
  await begin();const lateStop=recorder.onstop;act(()=>renderer.unmount());await act(async()=>lateStop());
  expect(onReady).not.toHaveBeenCalled();expect(stream.track.stop).toHaveBeenCalled();
});
test('unmount while permission is pending closes the late stream',async()=>{
  let pending;act(()=>{pending=capture.start();renderer.unmount();});permission.resolve(stream);await act(async()=>pending);
  expect(stream.track.stop).toHaveBeenCalled();expect(onReady).not.toHaveBeenCalled();expect(recorder).toBeNull();
});
test.each(['conversation','account','server'])('switching %s invalidates capture even on A-B-A',async mode=>{
  await begin();const lateStop=recorder.onstop;const original=props;
  props=mode==='conversation'?{...props,conversationId:'two'}:{...props,owner:{...props.owner,[mode==='account'?'accountId':'server']:'changed'}};
  fixture.owner=props.owner;refresh();props=original;fixture.owner=props.owner;refresh();
  await act(async()=>lateStop());expect(onReady).not.toHaveBeenCalled();expect(capture.phase).toBe('idle');
});
test.each(['blur','pagehide','Escape','hidden'])('%s cancels capture without sending',async event=>{
  await begin();act(()=>{if(event==='hidden'){documentEvents.visibilityState='hidden';documentEvents.fire('visibilitychange');}
    else if(event==='Escape')windowEvents.fire('keydown',{key:'Escape'});else windowEvents.fire(event);});
  expect(capture.phase).toBe('idle');expect(onReady).not.toHaveBeenCalled();expect(stream.track.stop).toHaveBeenCalled();
});
test('switching to text input cancels a held recording',async()=>{
  await begin();props={...props,enabled:false};refresh();expect(capture.phase).toBe('idle');expect(onReady).not.toHaveBeenCalled();
});
test('short recording has feedback and does not send',async()=>{
  await begin();vi.advanceTimersByTime(100);act(()=>capture.finish());await act(async()=>recorder.deliver());
  expect(onReady).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledWith('chat.voiceTooShort');
});
test('permission failure releases the capture lock for a new attempt',async()=>{
  let pending;act(()=>{pending=capture.start();});permission.reject(Error('denied'));await act(async()=>pending);
  expect(onError).toHaveBeenCalledWith('chat.micAccessDenied');expect(capture.phase).toBe('idle');
  permission=deferred();await begin();expect(capture.phase).toBe('recording');
});
test('an unexpected recorder stop cannot authorize sending',async()=>{
  await begin();vi.advanceTimersByTime(1500);await act(async()=>recorder.deliver());expect(onReady).not.toHaveBeenCalled();
});
test('credential revision changes discard a released capture',async()=>{
  await begin();vi.advanceTimersByTime(1500);fixture.revision++;act(()=>capture.finish());await act(async()=>recorder.deliver());
  expect(onReady).not.toHaveBeenCalled();expect(capture.phase).toBe('idle');
});
test('leaving while uploading aborts the owned operation',async()=>{
  const upload=deferred();onReady.mockReturnValue(upload.promise);await begin();vi.advanceTimersByTime(1500);
  act(()=>capture.finish());let pending;act(()=>{pending=recorder.deliver();});expect(capture.phase).toBe('sending');
  const operation=onReady.mock.calls[0][1];act(()=>renderer.unmount());expect(operation.signal.aborted).toBe(true);expect(operation.isCurrent()).toBe(false);
  upload.resolve();await act(async()=>pending);
});
test('blur after release does not cancel an already authorized upload',async()=>{
  const upload=deferred();onReady.mockReturnValue(upload.promise);await begin();vi.advanceTimersByTime(1500);act(()=>capture.finish());
  let pending;act(()=>{pending=recorder.deliver();});act(()=>windowEvents.fire('blur'));
  expect(capture.phase).toBe('sending');expect(onReady.mock.calls[0][1].signal.aborted).toBe(false);
  upload.resolve();await act(async()=>pending);
});
test('keyboard hold and release can send; repeated keydown does not restart capture',async()=>{
  const event={key:' ',preventDefault:vi.fn()};act(()=>button().props.onKeyDown(event));
  permission.resolve(stream);await act(async()=>{});act(()=>button().props.onKeyDown({...event,repeat:true}));
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);vi.advanceTimersByTime(1500);
  act(()=>button().props.onKeyUp(event));await act(async()=>recorder.deliver());expect(onReady).toHaveBeenCalledTimes(1);
});
test('pointer leaving the hold area cancels rather than sends',async()=>{
  const target={focus:vi.fn(),setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,top:0,right:100,bottom:50})};
  const event={pointerId:7,button:0,isPrimary:true,clientX:20,clientY:20,currentTarget:target,preventDefault:vi.fn()};
  act(()=>button().props.onPointerDown(event));permission.resolve(stream);await act(async()=>{});
  act(()=>button().props.onPointerMove({...event,clientY:70}));act(()=>button().props.onPointerUp(event));
  expect(capture.phase).toBe('idle');expect(onReady).not.toHaveBeenCalled();expect(stream.track.stop).toHaveBeenCalled();
});
test('non-primary touches and right-click cannot start recording',()=>{
  const event={pointerId:7,button:2,preventDefault:vi.fn()};act(()=>button().props.onPointerDown(event));
  act(()=>button().props.onPointerDown({...event,button:0,isPrimary:false}));expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});
test('window interruption resets the pointer gesture so a new press can record',async()=>{
  const target={focus:vi.fn(),setPointerCapture:vi.fn(),getBoundingClientRect:()=>({left:0,top:0,right:100,bottom:50})};
  const event={pointerId:7,button:0,isPrimary:true,clientX:20,clientY:20,currentTarget:target,preventDefault:vi.fn()};
  act(()=>button().props.onPointerDown(event));permission.resolve(stream);await act(async()=>{});
  act(()=>windowEvents.fire('blur'));permission=deferred();act(()=>button().props.onPointerDown({...event,pointerId:8}));
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);permission.resolve(stream);await act(async()=>{});
  expect(capture.phase).toBe('recording');
});
