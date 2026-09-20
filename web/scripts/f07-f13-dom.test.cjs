'use strict';
// Real React/DOM integration. Run with jsdom in NODE_PATH when it is provided by
// the isolated test toolchain; absence fails explicitly, never skips or falls back.
const {test,before,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const esbuild=require('../node_modules/esbuild');
let bundle,dom;
const channels=[];
const version=require('../../backend-v2/src/modules/legal/documents').version;
const consent={accepted:true,privacyVersion:version,termsVersion:version};
before(async()=>{
  const mocks={
    'axios':'export default window.__api;',
    'react-router-dom':`import React from 'react'; export const useNavigate=()=>()=>{}; export const useLocation=()=>({}); export const Link=({children,...p})=>React.createElement('a',p,children);`,
    '../contexts/AuthContext':'export const useAuth=()=>({login:window.__login,accounts:[],maxAccounts:5});',
    '../contexts/I18nContext':'export const useI18n=()=>({t:key=>key});',
    '../utils/rememberedCreds':"export const lastRememberedPhone=()=>''; export const saveCred=async()=>{}; export const hasCred=()=>false; export const removeCred=()=>{};",
    '../utils/clientStorage':'export const clientStorage={getItem:()=>null};',
    '../utils/config':'export const timeoutSignal=()=>null; export const resolveTenantCode=()=>null;',
    '../utils/toast':'export const showToast=()=>{};',
    '../components/AccountWindowButton':'export default ()=>null;',
  };
  const result=await esbuild.build({stdin:{contents:`
    import React, {act} from 'react'; import {createRoot} from 'react-dom/client';
    import Login from './src/pages/Login'; import Register from './src/pages/Register';
    import LegalConsent from './src/components/LegalConsent'; import {ReportDialog} from './src/components/ReportDialog';
    const root=createRoot(document.getElementById('root')); window.act=act;
    window.renderSafety=(kind,props={})=>root.render(React.createElement({Login,Register,LegalConsent,ReportDialog}[kind],props));
    window.unmountSafety=()=>root.unmount();`,resolveDir:path.resolve(__dirname,'..'),loader:'jsx'},
    bundle:true,write:false,format:'iife',loader:{'.js':'jsx','.css':'empty'},define:{'import.meta.env.BASE_URL':'"/"','process.env.NODE_ENV':'"test"'},
    plugins:[{name:'isolate-external-effects',setup(build){
      build.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);
      build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js',resolveDir:path.resolve(__dirname,'..')}));
    }}]});
  bundle=result.outputFiles[0].text;
});
function setup(){
  dom=new JSDOM('<div id="root"></div>',{url:'https://synthetic.invalid/',runScripts:'outside-only'});
  const w=dom.window,calls=[],logins=[];
  w.MessageChannel=class extends require('node:worker_threads').MessageChannel { constructor(){super();channels.push(this);} };
  w.IS_REACT_ACT_ENVIRONMENT=true;
  w.__login=(...args)=>logins.push(args);
  w.__api={defaults:{},get:async url=>({data:url==='/api/reports'?{items:[],hasMore:false}:url==='/api/config'?{features:{}}:{version,text:`${url} synthetic policy`}}),
    post:async(...args)=>{calls.push(args);return {data:{user:{id:'synthetic'},token:'synthetic'}};}};
  w.eval(bundle);return {w,calls,logins};
}
const query=s=>dom.window.document.querySelector(s);
const button=text=>[...dom.window.document.querySelectorAll('button')].find(b=>b.textContent===text);
const act=fn=>dom.window.act(async()=>{await fn();});
const fill=(selector,value)=>act(()=>{const el=query(selector);const proto=el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
const submit=()=>act(()=>query('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
afterEach(async()=>{if(dom){await act(()=>dom.window.unmountSafety());dom.window.close();dom=null;for(const c of channels.splice(0)){c.port1.close();c.port2.close();}}});
for(const kind of ['Login','Register'])test(`${kind}: real DOM checkbox gates submit, server versions are sent and unchecking blocks again`,async()=>{
  const {w,calls,logins}=setup();await act(()=>w.renderSafety(kind));
  const values=kind==='Login'?{phone:'13012345678',password:'Testpass123'}:{username:'tester',phone:'13012345678',password:'Testpass123',inviteCode:'123456'};
  for(const [name,value] of Object.entries(values))await fill(`#${kind==='Login'?'login':'reg'}-${name}`,value);
  assert.equal(query('button[type=submit]').disabled,true);await submit();assert.equal(calls.length,0);
  const checkbox=()=>query('[aria-label="同意隐私政策和用户协议"]');
  assert.equal(checkbox().checked,false);await act(()=>checkbox().click());
  assert.equal(query('button[type=submit]').disabled,false);await submit();
  assert.equal(calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].legalConsent)),consent);assert.equal(logins.length,1);
  await act(()=>checkbox().click());assert.equal(query('button[type=submit]').disabled,true);await submit();assert.equal(calls.length,1);
});
test('policy load failure keeps checkbox disabled; real retry and portal display fetched text',async()=>{
  const {w}=setup();const good=w.__api.get;w.__api.get=async()=>{throw Error('synthetic offline');};
  const changes=[];await act(()=>w.renderSafety('LegalConsent',{onChange:v=>changes.push(v)}));
  assert.equal(query('input').disabled,true);assert.match(query('[role=alert]').textContent,/政策加载失败/);assert.equal(changes.length,0);
  w.__api.get=good;await act(()=>button('重新加载').click());assert.equal(query('input').disabled,false);
  await act(()=>button('隐私政策').click());assert.match(query('[role=dialog]').textContent,/\/api\/legal\/privacy synthetic policy/);
  await act(()=>button('关闭').click());assert.equal(query('[role=dialog]'),null);
  await act(()=>query('input').click());assert.deepEqual(JSON.parse(JSON.stringify(changes)),[consent]);
});
test('report errors and invalid receipt never claim success; retry, refresh and resolution render in DOM',async()=>{
  const {w,calls}=setup();await act(()=>w.renderSafety('ReportDialog',{targetType:'message',targetId:'message-1',onClose:()=>{}}));
  await fill('textarea','synthetic report');
  w.__api.post=async(...args)=>{calls.push(args);throw {response:{data:{error:'synthetic unavailable'}}};};
  await submit();assert.match(query('[role=alert]').textContent,/synthetic unavailable/);assert.equal(query('[role=status]'),null);
  w.__api.post=async()=>({data:{status:'pending'}});await submit();assert.equal(query('[role=status]'),null);assert.match(query('[role=alert]').textContent,/提交失败/);
  w.__api.post=async(...args)=>{calls.push(args);return {data:{id:'ticket-123',status:'pending'}};};
  await submit();assert.match(query('[role=status]').textContent,/ticket-123.*待受理/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))),['/api/reports',{targetType:'message',targetId:'message-1',reason:'synthetic report'},{skipRetry:true}]);
  for(const [status,text] of [['reviewing','处理中'],['resolved','已处理']]){
    w.__api.get=async()=>({data:{items:[{id:'ticket-123',status,reason:'synthetic report',resolution:'synthetic resolution'}],hasMore:false}});
    await act(()=>button('刷新状态').click());assert.match(query('article').textContent,new RegExp(text));assert.match(query('article').textContent,/synthetic resolution/);
  }
});
