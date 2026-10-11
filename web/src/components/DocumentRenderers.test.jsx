import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, expect, test, vi } from 'vitest';
import { DocumentRenderer, PdfRenderer, PdfPage } from './DocumentRenderers';
import { resolveMediaUrl } from '../utils/url';
import { getDocument } from 'pdfjs-dist';
import { renderAsync } from 'docx-preview';

vi.mock('../contexts/I18nContext', () => ({ useI18n: () => ({ t: key => key }) }));
vi.mock('../utils/url', () => ({ resolveMediaUrl: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));
vi.mock('docx-preview', () => ({ renderAsync: vi.fn() }));
let view;
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; };
const handlers = () => ({ onLoaded: vi.fn(), onError: vi.fn() });
async function mount(props, Component = DocumentRenderer, options) {
  await act(async () => { view = create(<Component {...props} />, options); });
}
afterEach(() => { if (view) act(() => view.unmount()); view = null; vi.clearAllMocks(); vi.unstubAllGlobals(); });

test('text loads with an abortable credentialed request and parses quoted CSV cells', async () => {
  resolveMediaUrl.mockResolvedValue('/a.csv');
  const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'name,note\n"a,b","<strong>literal</strong>"' });
  vi.stubGlobal('fetch', fetch); const callbacks = handlers();
  await mount({ fileUrl:'/a.csv', filename:'a.csv', kind:'text', ...callbacks });
  expect(view.root.findAllByType('td').map(cell => cell.props.children)).toEqual(['name','note','a,b','<strong>literal</strong>']);
  expect(callbacks.onLoaded).toHaveBeenCalledTimes(1);
  const options = fetch.mock.calls[0][1]; expect(options.credentials).toBe('include');
  act(() => view.unmount()); view = null; expect(options.signal.aborted).toBe(true);
});
test('network and parse failures reach the retry state', async () => {
  resolveMediaUrl.mockResolvedValue('/a.txt'); vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false }));
  const callbacks = handlers(); await mount({fileUrl:'/a.txt',kind:'text',...callbacks});
  expect(callbacks.onError).toHaveBeenCalledTimes(1); expect(callbacks.onLoaded).not.toHaveBeenCalled();
});
test('a closed preview ignores a late response even if the transport ignores abort', async () => {
  resolveMediaUrl.mockResolvedValue('/a.txt'); const response = deferred();
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(response.promise)); const callbacks = handlers();
  await mount({fileUrl:'/a.txt',kind:'text',...callbacks}); act(() => view.unmount()); view = null;
  await act(async () => response.resolve({ok:true,text:async()=> 'old'}));
  expect(callbacks.onLoaded).not.toHaveBeenCalled(); expect(callbacks.onError).not.toHaveBeenCalled();
});
test('closing during authorization avoids starting a fetch', async () => {
  const auth = deferred(); resolveMediaUrl.mockReturnValue(auth.promise); const fetch = vi.fn(); vi.stubGlobal('fetch',fetch);
  await mount({fileUrl:'/a.txt',kind:'text',...handlers()}); act(() => view.unmount()); view=null;
  await act(async () => auth.resolve('/a.txt')); expect(fetch).not.toHaveBeenCalled();
});
test('closing during Word rendering suppresses its completion', async () => {
  resolveMediaUrl.mockResolvedValue('/a.docx'); vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)}));
  const render = deferred(); renderAsync.mockReturnValue(render.promise); const callbacks = handlers();
  await mount({fileUrl:'/a.docx',kind:'docx',...callbacks},DocumentRenderer,{createNodeMock:()=>({})});
  expect(renderAsync).toHaveBeenCalledTimes(1); act(() => view.unmount()); view=null;
  await act(async () => render.resolve()); expect(callbacks.onLoaded).not.toHaveBeenCalled();
});
test('PDF loading tasks are destroyed on close and cannot report late success', async () => {
  resolveMediaUrl.mockResolvedValue('/a.pdf'); const document = deferred(); const destroy = vi.fn().mockResolvedValue();
  getDocument.mockReturnValue({promise:document.promise,destroy}); const callbacks=handlers();
  await mount({fileUrl:'/a.pdf',...callbacks},PdfRenderer); expect(getDocument).toHaveBeenCalledTimes(1);
  act(() => view.unmount()); view=null; expect(destroy).toHaveBeenCalledTimes(1);
  await act(async()=>document.resolve({numPages:1})); expect(callbacks.onLoaded).not.toHaveBeenCalled();
});
test('PDF document rejection becomes an error, including worker failures', async () => {
  resolveMediaUrl.mockResolvedValue('/a.pdf'); getDocument.mockImplementation(()=>({promise:Promise.reject(new Error('worker')),destroy:vi.fn()}));
  const callbacks=handlers(); await mount({fileUrl:'/a.pdf',...callbacks},PdfRenderer); expect(callbacks.onError).toHaveBeenCalledTimes(1);
});
function pageNodes() {
  vi.stubGlobal('window',{addEventListener:vi.fn(),removeEventListener:vi.fn(),devicePixelRatio:2});
  const canvas={style:{},getContext:()=>({})}; const host={style:{}};
  return {canvas,host,options:{createNodeMock:element=>element.type==='canvas'?canvas:host},scrollRef:{current:{clientWidth:320}}};
}
test('PDF rendering errors propagate instead of leaving a blank document', async () => {
  const nodes=pageNodes(); const callbacks=handlers(); const doc={getPage:vi.fn().mockRejectedValue(new Error('page damaged'))};
  await mount({doc,number:1,scale:1,scrollRef:nodes.scrollRef,...callbacks},PdfPage,nodes.options);
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
});
test('PDF close cancels an in-flight render and releases its canvas', async () => {
  const nodes=pageNodes(); const render=deferred(); const cancel=vi.fn(); const callbacks=handlers();
  const doc={getPage:async()=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:render.promise,cancel})})};
  await mount({doc,number:1,scale:1,scrollRef:nodes.scrollRef,...callbacks},PdfPage,nodes.options);
  expect(nodes.canvas.style.width).toBe('296px'); act(()=>view.unmount()); view=null;
  expect(cancel).toHaveBeenCalledTimes(1); expect(nodes.canvas.width).toBe(0);
  await act(async()=>render.reject(new Error('cancelled'))); expect(callbacks.onError).not.toHaveBeenCalled();
});
test('offscreen PDF pages do not fetch or allocate canvases until near the viewport', async () => {
  const nodes=pageNodes(); let observe; const disconnect=vi.fn();
  vi.stubGlobal('IntersectionObserver',class { constructor(callback) { observe=callback; } observe() {} disconnect=disconnect; });
  const callbacks=handlers(); const doc={getPage:vi.fn().mockResolvedValue({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>({promise:Promise.resolve(),cancel:vi.fn()})})};
  await mount({doc,number:5,scale:1,scrollRef:nodes.scrollRef,...callbacks},PdfPage,nodes.options);
  expect(doc.getPage).not.toHaveBeenCalled();
  await act(async()=>observe([{isIntersecting:true}])); expect(doc.getPage).toHaveBeenCalledWith(5);
  act(()=>observe([{isIntersecting:false}])); expect(nodes.canvas.width).toBe(0);
});
