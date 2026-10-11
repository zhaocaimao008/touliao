import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { uploadBlob } from './uploadBlob';
let xhr;
class XHR extends EventTarget {
  constructor(){super();xhr=this;this.upload=new EventTarget();this.status=200;this.open=vi.fn();this.send=vi.fn();this.setRequestHeader=vi.fn();this.abort=vi.fn(()=>this.dispatchEvent(new Event('abort')));}
}
beforeEach(()=>vi.stubGlobal('XMLHttpRequest',XHR));
afterEach(()=>vi.unstubAllGlobals());
test('aborted before starting sends no bytes',async()=>{
  const controller=new AbortController();controller.abort();await expect(uploadBlob('/upload',new Blob(),'',{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(xhr.send).not.toHaveBeenCalled();
});
test('abort reaches XHR and stops late progress updates',async()=>{
  const controller=new AbortController(),onProgress=vi.fn();const pending=uploadBlob('/upload',new Blob(),'audio/webm',{signal:controller.signal,onProgress});
  const progress=()=>{const event=new Event('progress');Object.assign(event,{lengthComputable:true,loaded:5,total:10});xhr.upload.dispatchEvent(event);};
  progress();expect(onProgress).toHaveBeenCalledWith(50);controller.abort();progress();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(xhr.abort).toHaveBeenCalledTimes(1);expect(onProgress).toHaveBeenCalledTimes(1);
});
test('success removes the abort listener and has a bounded timeout',async()=>{
  const controller=new AbortController();const pending=uploadBlob('/upload',new Blob(),'audio/webm',{signal:controller.signal});
  expect(xhr.timeout).toBe(600000);xhr.dispatchEvent(new Event('load'));await pending;controller.abort();expect(xhr.abort).not.toHaveBeenCalled();
});
test.each(['error','timeout'])('%s rejects instead of hanging indefinitely',async event=>{
  const pending=uploadBlob('/upload',new Blob(),'audio/webm',{errorText:()=> 'Network issue'});xhr.dispatchEvent(new Event(event));await expect(pending).rejects.toThrow('Network issue');
});
test('non-success HTTP response includes status-specific feedback',async()=>{
  const pending=uploadBlob('/upload',new Blob(),'audio/webm',{errorText:status=>'HTTP '+status});xhr.status=503;xhr.dispatchEvent(new Event('load'));await expect(pending).rejects.toThrow('HTTP 503');
});
