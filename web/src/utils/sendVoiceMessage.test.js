import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { sendVoiceMessage } from './sendVoiceMessage';
const deferred = () => { let resolve, reject; const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject}; };
let options, controller, current, ack, message;
beforeEach(()=>{
  vi.useFakeTimers();controller=new AbortController();current=true;
  message={id:'confirmed',conversation_id:'conversation',sender_id:'owner',client_msg_id:'pending',type:'voice'};
  options={recording:{blob:new Blob(['audio']),mimeType:'audio/webm',filename:'voice.webm'},conversationId:'conversation',clientMsgId:'pending',
    operation:{signal:controller.signal,session:{accountId:'owner'},isCurrent:()=>current},
    uploadCloud:vi.fn().mockResolvedValue({publicUrl:'/file.webm'}),uploadLocal:vi.fn().mockResolvedValue('/local.webm'),
    socket:{connected:true,emit:vi.fn((_event,_body,callback)=>{ack=callback;})},onProgress:vi.fn(),t:key=>key};
});
afterEach(()=>{vi.useRealTimers();});
test('a confirmed cloud send returns the authoritative message',async()=>{
  const pending=sendVoiceMessage(options);await Promise.resolve();ack({success:true,message});
  expect(await pending).toEqual({route:'cloud',message});expect(options.socket.emit).toHaveBeenCalledTimes(1);
  expect(options.uploadCloud.mock.calls[0][4]).toMatchObject({signal:controller.signal,_sessionContext:{accountId:'owner'}});
});
test('network failure uses one scoped local upload and no socket duplicate',async()=>{
  options.uploadCloud.mockRejectedValue(Error('network'));
  expect(await sendVoiceMessage(options)).toEqual({route:'local'});expect(options.uploadLocal).toHaveBeenCalledTimes(1);
  expect(options.uploadLocal.mock.calls[0][2]).toMatchObject({signal:controller.signal,skipReply:true});expect(options.socket.emit).not.toHaveBeenCalled();
});
test.each([400,401,403])('HTTP %s does not bypass failure with a second upload',async status=>{
  const error={response:{status}};options.uploadCloud.mockRejectedValue(error);
  await expect(sendVoiceMessage(options)).rejects.toBe(error);expect(options.uploadLocal).not.toHaveBeenCalled();
});
test('cancelled operation starts no request',async()=>{
  controller.abort();expect(await sendVoiceMessage(options)).toBeNull();expect(options.uploadCloud).not.toHaveBeenCalled();
});
test('cancellation during cloud upload cannot fall back locally',async()=>{
  const cloud=deferred();options.uploadCloud.mockReturnValue(cloud.promise);const pending=sendVoiceMessage(options);
  controller.abort();cloud.reject(Error('abort'));expect(await pending).toBeNull();expect(options.uploadLocal).not.toHaveBeenCalled();
});
test('account change after upload cannot emit a message',async()=>{
  const cloud=deferred();options.uploadCloud.mockReturnValue(cloud.promise);const pending=sendVoiceMessage(options);
  current=false;cloud.resolve({publicUrl:'/file.webm'});expect(await pending).toBeNull();expect(options.socket.emit).not.toHaveBeenCalled();
});
test('connection loss before emission gives feedback instead of buffering an old send',async()=>{
  options.socket.connected=false;await expect(sendVoiceMessage(options)).rejects.toThrow('chat.connectionLostRetry');expect(options.socket.emit).not.toHaveBeenCalled();
});
test('missing acknowledgement times out without automatically resending',async()=>{
  const pending=sendVoiceMessage(options);const assertion=expect(pending).rejects.toThrow('chat.voiceDeliveryUnconfirmed');
  await vi.advanceTimersByTimeAsync(15000);await assertion;expect(options.socket.emit).toHaveBeenCalledTimes(1);expect(options.uploadLocal).not.toHaveBeenCalled();
});
test('unmount aborts acknowledgement waiting and ignores a late success',async()=>{
  const pending=sendVoiceMessage(options);const assertion=expect(pending).rejects.toMatchObject({name:'AbortError'});await Promise.resolve();
  controller.abort();ack({success:true,message});await assertion;expect(vi.getTimerCount()).toBe(0);
});
test.each(['conversation_id','sender_id','client_msg_id','type'])('mismatched %s cannot confirm delivery',async field=>{
  const pending=sendVoiceMessage(options);await Promise.resolve();ack({success:true,message:{...message,[field]:'different'}});
  await expect(pending).rejects.toThrow('chat.voiceDeliveryUnconfirmed');
});
test('server rejection preserves a specific error',async()=>{
  const pending=sendVoiceMessage(options);await Promise.resolve();ack({success:false,error:'Muted'});await expect(pending).rejects.toThrow('Muted');
});
test('credential invalidation while awaiting acknowledgement cannot complete old work',async()=>{
  const pending=sendVoiceMessage(options);await Promise.resolve();current=false;ack({success:true,message});await expect(pending).rejects.toMatchObject({name:'AbortError'});
});
