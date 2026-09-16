// Local-only browser regression. Uses real React and WebRTC with synthetic devices.
// npm install --prefix tests && npm install --prefix web
// node tests/e2e/group-call-regression.mjs
// Optional: PLAYWRIGHT_MODULE=/absolute/module.js CHROMIUM_PATH=/absolute/chromium
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from '../../web/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE || require.resolve('playwright')).href);
const { chromium } = playwright.default || playwright;
const root = fileURLToPath(new URL('../../web/', import.meta.url));
const fixtureId = path.join(root, '__call_fixture__.jsx');
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import GroupCallModal from '/src/components/GroupCallModal.jsx';
import { I18nProvider } from '/src/contexts/I18nContext.jsx';
import '/src/design-tokens.css';
import '/src/index.css';
window.events = []; window.auditClosed = 0;
const handlers = {};
window.socket = { connected: true, on(e,f) { (handlers[e] ??= new Set()).add(f); }, off(e,f) { handlers[e]?.delete(f); }, emit(e,p) { events.push({e,p}); } };
window.deliver = (e,p) => Promise.all([...(handlers[e] || [])].map(f => f(p)));
const mode = new URLSearchParams(location.search).get('mode') || 'start';
function Host() {
  const [closed, setClosed] = React.useState(false);
  return <><input aria-label="测试聊天输入" /><button onClick={() => { window.chatSent = true; }}>发送测试消息</button>{closed ? <p>closed</p> : <GroupCallModal socket={socket} user={{id: mode === 'start' ? 'a' : 'b'}} session={{mode, conversationId:'audit-group', type:'audio', ...(mode === 'join' ? {callId:'pair'} : {})}} onClose={() => { auditClosed++; setClosed(true); }} />}</>;
}
createRoot(document.getElementById('root')).render(<I18nProvider><Host /></I18nProvider>);
`;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false }, plugins: [{
  name: 'local-call-fixture',
  resolveId(id) { if (id === '/__call_fixture__.jsx' || id === fixtureId) return fixtureId; },
  load(id) { if (id === fixtureId) return entry; },
  configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/__call_fixture__?')) return next();
      vite.transformIndexHtml('/__call_fixture__', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__call_fixture__.jsx"></script></body></html>')
        .then(html => { res.setHeader('Content-Type', 'text/html'); res.end(html); }).catch(next);
    });
  },
}] });
let browser;
const output = process.env.CALL_TEST_OUTPUT || await fs.mkdtemp(path.join(os.tmpdir(), 'touliao-call-regression-'));
const errors = [];
try {
  await fs.mkdir(output, { recursive: true });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  async function openCall(mode = 'start', denied = false) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/turn/credentials', r => r.fulfill({ json: { iceServers: [{ urls: 'stun:127.0.0.1:3478' }] } }));
    await page.route('**/api/messages/conversation/*/members', r => r.fulfill({ json: [{id:'a',username:'测试甲'}, {id:'b',username:'测试乙'}] }));
    await page.addInitScript(({ denied }) => {
      window.auditDeny = denied; window.captured = []; window.auditPCs = [];
      window.auditContexts = []; window.testToneContexts = []; window.auditOutputs = ['headset', 'speaker', 'broken'];
      const OriginalContext = window.AudioContext;
      window.AudioContext = class extends OriginalContext {
        constructor(...args) { super(...args); auditContexts.push(this); }
        createMediaStreamSource(stream) { this.auditMeter = true; return super.createMediaStreamSource(stream); }
      };
      navigator.mediaDevices.enumerateDevices = async () => auditOutputs.map(deviceId => ({kind:'audiooutput', deviceId, label:deviceId}));
      navigator.mediaDevices.selectAudioOutput = async () => ({kind:'audiooutput',deviceId:'headset',label:'headset'});
      const nativeSink = HTMLMediaElement.prototype.setSinkId;
      HTMLMediaElement.prototype.setSinkId = async function(id) {
        if (id === 'broken') throw new DOMException('Device removed', 'NotFoundError');
        if (nativeSink) await nativeSink.call(this, '');
        this.auditSink = id;
      };

      const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (auditDeny) throw new DOMException('Denied', 'NotAllowedError');
        const stream = await gum(constraints);
        if (constraints.audio && !constraints.video) {
          stream.getAudioTracks().forEach(track => track.stop());
          const context = new OriginalContext();
          const oscillator = context.createOscillator(); const gain = context.createGain();
          const destination = context.createMediaStreamDestination();
          oscillator.frequency.value = 440; gain.gain.value = .12;
          oscillator.connect(gain).connect(destination); oscillator.start(); await context.resume();
          testToneContexts.push(context);
          const audio = destination.stream; captured.push(audio); return audio;
        }
        captured.push(stream); return stream;
      };
      const Native = RTCPeerConnection;
      window.RTCPeerConnection = class extends Native { constructor(config) { super(config); auditPCs.push(this); } };
    }, { denied });
    await page.goto(`${base}/__call_fixture__?mode=${mode}`);
    return page;
  }
  const denied = await openCall('start', true);
  await denied.getByRole('alert').waitFor();
  assert.equal(await denied.evaluate(() => events.length), 0, 'permission failure must not join');
  assert.equal(await denied.getByRole('button', { name:'静音', exact:true }).isDisabled(), true);
  await denied.screenshot({ path:path.join(output,'microphone-error.png') });
  await denied.evaluate(() => { auditDeny = false; });
  await denied.getByRole('button', {name:'重试',exact:true}).click();
  await denied.waitForFunction(() => events.some(e => e.e === 'group_call:start'));
  await denied.evaluate(() => deliver('group_call:started', {callId:'error-call', requestId:events.find(e => e.e === 'group_call:start').p.requestId}));
  await denied.getByText('等待他人加入…', {exact:true}).waitFor();
  await denied.evaluate(() => deliver('group_call:error', {callId:'stale-call',reason:'not_found'}));
  assert.equal(await denied.evaluate(() => auditClosed),0);
  await denied.evaluate(() => deliver('group_call:error', {callId:'error-call',reason:'not_found'}));
  await denied.waitForFunction(() => auditClosed === 1);
  assert.equal(await denied.getByRole('dialog').count(),0);
  assert.ok(await denied.evaluate(() => captured.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
  await denied.context().close();

  const a = await openCall(); const b = await openCall('join');
  await a.waitForFunction(() => events.some(e => e.e === 'group_call:start'));
  await b.waitForFunction(() => events.some(e => e.e === 'group_call:join'));
  await a.evaluate(() => deliver('group_call:started', {callId:'pair',requestId:events.find(e => e.e === 'group_call:start').p.requestId}));
  await a.getByText('等待他人加入…',{exact:true}).waitFor();
  for (const [page, target, from] of [[a,b,'a'],[b,a,'b']]) {
    await page.exposeFunction('relay', async (e,p) => {
      if (['group_call:offer','group_call:answer','group_call:ice'].includes(e)) await target.evaluate(({e,p,from}) => deliver(e,{...p,from}), {e,p,from});
    });
    await page.evaluate(() => { const emit = socket.emit; socket.emit = (e,p) => { emit(e,p); window.relay(e,p); }; });
  }
  await b.evaluate(() => deliver('group_call:peers',{callId:'pair',peers:['a']}));
  await a.evaluate(() => deliver('group_call:peer_joined',{callId:'pair',userId:'b'}));
  for (const page of [a,b]) await page.waitForFunction(() => auditPCs.length && auditPCs.every(pc => pc.connectionState === 'connected'));
  await a.locator('.gcm-tile').filter({hasText:'测试乙'}).waitFor();
  await a.getByRole('button',{name:'静音',exact:true}).click();
  assert.ok(await a.evaluate(() => captured[0].getAudioTracks().every(t => !t.enabled)));
  await a.getByRole('button',{name:'取消静音',exact:true}).click();
  assert.ok(await a.evaluate(() => captured[0].getAudioTracks().every(t => t.enabled)));
  await a.waitForTimeout(1200);
  const stats = [];
  for (const page of [a,b]) {
    const packets = await page.evaluate(async () => [...(await auditPCs[0].getStats()).values()].filter(s => s.kind === 'audio' && ['inbound-rtp','outbound-rtp'].includes(s.type)).map(s => ({type:s.type,packets:s.packetsReceived ?? s.packetsSent})));
    assert.equal(packets.length,2); assert.ok(packets.every(p => p.packets > 0)); stats.push(packets);
  }
  await a.locator('.gcm-tile--speaking').filter({hasText:'测试乙'}).waitFor();
  await a.getByRole('button', {name:'声音设置', exact:true}).click();
  await a.getByRole('button',{name:'选择其他设备',exact:true}).click();
  await a.waitForFunction(() => document.querySelector('audio[data-peer-id="b"]').auditSink === 'headset');
  await a.getByRole('combobox').selectOption('broken');
  await a.getByRole('alert').filter({hasText:'音频输出切换失败'}).waitFor();
  assert.equal(await a.getByRole('combobox').inputValue(),'headset');
  await a.getByRole('combobox').selectOption('speaker');
  await a.waitForFunction(() => document.querySelector('audio[data-peer-id="b"]').auditSink === 'speaker');
  await a.evaluate(() => { auditOutputs = ['headset']; navigator.mediaDevices.dispatchEvent(new Event('devicechange')); });
  await a.waitForFunction(() => document.querySelector('audio[data-peer-id="b"]').auditSink === '');
  assert.equal(await a.getByRole('combobox').inputValue(),'');
  await a.getByRole('slider',{name:'测试乙 的音量',exact:true}).fill('35');
  await a.waitForFunction(() => document.querySelector('audio[data-peer-id="b"]').volume === .35);
  await a.screenshot({path:path.join(output,'audio-settings.png')});
  await a.getByRole('button',{name:'声音设置',exact:true}).click();
  await a.screenshot({path:path.join(output,'group-connected.png')});
  const beforeMini = await a.evaluate(async () => {
    window.originalAudio = document.querySelector('audio[data-peer-id="b"]');
    return [...(await auditPCs[0].getStats()).values()].find(s => s.type === 'inbound-rtp' && s.kind === 'audio').packetsReceived;
  });
  await a.getByRole('button',{name:'缩小',exact:true}).click();
  await a.locator('.gcm-mini').waitFor();
  assert.equal(await a.getByRole('dialog').count(),0);
  await a.getByRole('textbox',{name:'测试聊天输入'}).fill('通话期间继续聊天');
  await a.getByRole('button',{name:'发送测试消息'}).click();
  assert.ok(await a.evaluate(()=>chatSent));
  await a.waitForTimeout(700);
  assert.ok(await a.evaluate(() => originalAudio === document.querySelector('audio[data-peer-id="b"]') && !originalAudio.paused));
  const afterMini = await a.evaluate(async () => [...(await auditPCs[0].getStats()).values()].find(s => s.type === 'inbound-rtp' && s.kind === 'audio').packetsReceived);
  assert.ok(afterMini > beforeMini, 'audio RTP continues while minimized');
  await a.screenshot({path:path.join(output,'minimized.png')});
  await a.getByRole('button',{name:'静音',exact:true}).click();
  assert.ok(await a.evaluate(()=>captured[0].getAudioTracks().every(t=>!t.enabled)));
  await a.getByRole('button',{name:'取消静音',exact:true}).click();
  const handle = await a.locator('.gcm-mini-drag').boundingBox();
  await a.mouse.move(handle.x+20,handle.y+8);await a.mouse.down();await a.mouse.move(12,12);await a.mouse.up();
  await a.setViewportSize({width:320,height:650});
  const miniBounds = await a.locator('.gcm-mini').boundingBox();
  assert.ok(miniBounds.x >= 0 && miniBounds.x + miniBounds.width <= 320);
  await a.locator('.gcm-mini-restore').click();
  await a.getByRole('dialog').waitFor();
  assert.ok(await a.evaluate(() => originalAudio === document.querySelector('audio[data-peer-id="b"]') && originalAudio.volume === .35));
  await a.setViewportSize({width:390,height:844});

  await a.evaluate(() => {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async c => { const stream = await gum(c); window.lateVideo = stream; await new Promise(resolve => { window.releaseVideo = resolve; }); return stream; };
  });
  await a.getByRole('button',{name:'开摄像头',exact:true}).click();
  await a.waitForFunction(() => window.releaseVideo);
  await a.getByRole('button',{name:'挂断',exact:true}).click();
  await a.evaluate(() => releaseVideo());
  await a.waitForFunction(() => lateVideo.getTracks().every(t => t.readyState === 'ended'));
  assert.equal(await a.getByRole('dialog').count(),0);
  await b.getByRole('button',{name:'缩小',exact:true}).click();
  await b.getByRole('button',{name:'挂断',exact:true}).click();
  assert.ok(await b.evaluate(() => captured.every(s => s.getTracks().every(t => t.readyState === 'ended'))));
  for (const page of [a,b]) {
    assert.ok(await page.evaluate(() => auditContexts.filter(ctx=>ctx.auditMeter).every(ctx=>ctx.state==='closed')));
    assert.equal(await page.locator('audio[data-peer-id]').count(),0);
  }
  assert.deepEqual(errors,[]);
  // Real Home composition: resizing must not remount an ongoing minimized call.
  const homeContext = await browser.newContext({viewport:{width:390,height:844}});
  const home = await homeContext.newPage();
  home.on('pageerror', error => errors.push(error.message));
  await home.addInitScript(() => {
    window.homePCs = []; window.homeEvents = [];
    const Native = RTCPeerConnection;
    window.RTCPeerConnection = class extends Native { constructor(config) { super(config); homePCs.push(this); } };
    // Exercise the capability fallback separately from the device-selector fixture above.
    delete HTMLMediaElement.prototype.setSinkId;
  });
  await home.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('config.json')) return route.fulfill({json:{api:'',socket:''}});
    if (url.pathname.startsWith('/api/')) {
      let body = {};
      if (url.pathname === '/api/auth/me') body = {id:'home-user',username:'界面测试',wechat_id:'home-test'};
      else if (url.pathname === '/api/config') body = {features:{}};
      else if (url.pathname === '/api/turn/credentials') body = {iceServers:[{urls:'stun:127.0.0.1:3478'}]};
      else if (/\/members$/.test(url.pathname)) body = Array.from({length:8}, (_,i)=>({id:`member-${i}`,username:`群成员 ${i+1}`}));
      else if (url.pathname === '/api/messages/conversations') body = [{id:'test-chat',type:'group',name:'通话中的讨论组'}];
      else if (url.pathname === '/api/messages/test-chat' || url.pathname.endsWith('/pinned-messages') || /contacts|friend-requests|call-logs|my-groups|friend-labels|blocked|collections|moments/.test(url.pathname)) body=[];
      return route.fulfill({json:body});
    }
    if (url.origin !== base) return route.abort();
    return route.continue();
  });
  await home.goto(base);
  await home.waitForFunction(()=>window.__touliaoSocket?.listeners('group_call:invite').length > 0);
  await home.evaluate(() => {
    const socket = __touliaoSocket;
    socket.connected = true;
    socket.emitEvent(['connect']);
    socket.emit = (event,payload) => {
      homeEvents.push({event,payload});
      if (event === 'group_call:join') setTimeout(()=>socket.emitEvent(['group_call:peers',{
        callId:'home-call',peers:Array.from({length:8},(_,i)=>`member-${i}`),resumeToken:'test',
      }]),0);
      return socket;
    };
    socket.emitEvent(['group_call:invite',{callId:'home-call',conversationId:'home-group',fromName:'群成员',type:'audio',expiresAt:Date.now()+60000}]);
  });
  await home.locator('.home-group-invite').getByRole('button',{name:'加入',exact:true}).click();
  await home.waitForFunction(()=>homePCs.length===8);
  await home.locator('.gcm-tile').filter({hasText:'群成员 8'}).waitFor();
  for (const viewport of [{width:320,height:650},{width:390,height:844},{width:844,height:390},{width:1440,height:900}]) {
    await home.setViewportSize(viewport);
    await home.waitForTimeout(120);
    assert.equal(await home.locator('.gcm-tile').count(),9);
    assert.ok(await home.evaluate(()=>homePCs.length===8 && !homeEvents.some(e=>e.event==='group_call:leave')));
    const controls = await home.locator('.gcm-controls').boundingBox();
    assert.ok(controls.y >= 0 && controls.y + controls.height <= viewport.height + 1);
    assert.ok(await home.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await home.screenshot({path:path.join(output,`nine-members-${viewport.width}.png`)});
  }
  await home.getByRole('button',{name:'声音设置',exact:true}).click();
  await home.getByText('当前浏览器使用系统音频输出，请在系统设置中切换。',{exact:true}).waitFor();
  assert.equal(await home.getByRole('combobox').count(),0);
  await home.getByRole('button',{name:'缩小',exact:true}).click();
  await home.getByTestId('nav-tab-contacts').click();
  await home.setViewportSize({width:390,height:844});
  await home.getByTestId('nav-tab-calls').click();
  await home.getByTestId('nav-tab-chats').click();
  await home.getByText('通话中的讨论组',{exact:true}).click();
  await home.locator('.m-chat-page').waitFor();
  await home.waitForTimeout(350);
  await home.screenshot({path:path.join(output,'home-chat-before-busy.png')});
  assert.deepEqual(errors,[]);
  assert.ok(await home.locator('.gcm-mini').isVisible());
  await home.getByPlaceholder('输入消息…').fill('通话期间继续输入消息');
  const inputBounds = await home.getByPlaceholder('输入消息…').boundingBox();
  const floatingBounds = await home.locator('.gcm-mini').boundingBox();
  assert.ok(floatingBounds.y + floatingBounds.height <= inputBounds.y, 'default mini position leaves the composer accessible');
  // Incoming private calls are rejected as busy without opening a second modal.
  await home.evaluate(()=>__touliaoSocket.emitEvent(['call:incoming',{from:'new-caller',type:'audio',callId:'other-call',caller:{name:'测试来电'}}]));
  await home.waitForFunction(()=>homeEvents.some(e=>e.event==='call:response' && e.payload.busy));
  assert.equal(await home.getByTestId('call-modal').count(),0);
  // Starting another group call from the chat toolbar must preserve the existing session.
  const startGroup = home.getByRole('button',{name:'群语音通话',exact:true});
  await startGroup.click();
  assert.ok(await home.evaluate(()=>homePCs.length===8 && !homeEvents.some(e=>e.event==='group_call:start')));
  await home.screenshot({path:path.join(output,'home-minimized-chat.png')});
  await home.locator('.gcm-mini-restore').click();
  await home.getByRole('button',{name:'挂断',exact:true}).click();
  assert.ok(await home.evaluate(()=>homePCs.every(pc=>pc.connectionState==='closed')));
  await homeContext.close();
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(output,'results.json'), JSON.stringify({permissionRetry:true,waiting:true,errorUnmount:true,mute:true,lateCameraStopped:true,audioOutput:true,failedOutputRollback:true,outputUnplug:true,memberVolume:true,speaking:true,minimizedPlayback:true,minimizedChat:true,dragAndResize:true,metersDisposed:true,nineMemberLayout:true,homeNavigationAndResize:true,composerUnobscured:true,unsupportedOutputFallback:true,busyProtection:true,stats},null,2));
  console.log(`PASS: permission retry, output selection/rollback/unplug, speaking, member volume, minimized chat/audio, drag/resize, complete teardown. Evidence: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
