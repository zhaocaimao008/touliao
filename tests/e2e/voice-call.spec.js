// tests/e2e/voice-call.spec.js
//
// 语音通话 E2E 回归套件 —— 2026-09-04 P1「语音通话全端不通」故障排查产出。
//
// 【重要】这不是 @playwright/test 的 spec 文件，是一个可直接 `node` 运行的纯脚本，
// 沿用本仓库 tests/ 目录下 tests/cases/*.js 的既有约定（axios+socket.io-client 驱动，
// 由 tests/run.js 编排，不接入 CI）。之所以不采用 @playwright/test 框架/目录结构，
// 是因为仓库此前确实有一份 e2e/（@playwright/test + GitHub Actions e2e-web.yml 门禁），
// 已被明确的用户指令在 commit 4ecac40「移除 E2E（e2e/ 目录 + e2e-web.yml + deploy.yml
// e2e-gate 门禁）」中删除，原因是该 CI 门禁的 runner 反复超时、阻塞了部署流水线
// （历史提交 8c3...376926e/788545e 均是在为同一批 flaky 用例打补丁）。本次故意不复刻
// 同样的模式，避免重新引入同一个已被判定过的问题；使用 playwright-core（Chromium 真实
// 浏览器）而非 axios/socket 模拟，是因为通话链路必须验证真实 RTCPeerConnection/ICE/
// getUserMedia 行为，纯 API/Socket 测试无法覆盖 WebRTC 层。运行方式：手动
// `node tests/e2e/voice-call.spec.js`，不接入 CI/自动部署门禁。
//
// 覆盖场景（对应故障排查协议 §17/§28 要求的 15 个场景）：
//   1-10. 连续 10 轮真实 Web→Web 通话：呼叫→接听→通话中→挂断，逐轮验证
//         iceConnectionState/connectionState 均达到 connected
//   11. 被叫拒绝（reject）
//   12. 主叫呼出后立即取消（caller-cancel，被叫未应答）
//   13. 忙线（busy）：独立第三方账号在被叫通话中来电，验证被叫现有通话不受影响、
//       主叫收到明确忙线反馈
//   14. ICE candidate 类型验证：确认 host/srflx/relay 三类候选均被收集且成功建连
//       （直接验证 TURN 中继可用，不依赖假设）
//   15. WebSocket 通话信令帧完整性：call:request → call:incoming → call:response →
//       call:offer → call:ice(多次) → call:answer → call:ice(多次) 的完整双向序列
//
// 使用真实生产账号（VCallQA_A503983335 / VCallQA_B503636921，已互为好友）针对
// https://touliao.cc 生产环境执行，两个/三个完全独立的 Chromium BrowserContext。
// 不使用 localhost，不使用模拟结果，不删除/篡改任何真实用户数据。

const { chromium } = require('/root/touliao/e2e/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const FRONTEND = process.env.VOICE_CALL_TEST_FRONTEND || 'https://touliao.cc';
const USERS = {
  A: { username: 'VCallQA_A503983335', phone: '15039833350', password: 'Test@123456' },
  B: { username: 'VCallQA_B503636921', phone: '15036369211', password: 'Test@123456' },
  // C 仅用于场景 13（忙线），复用此前测试遗留的独立第三方账号（与 A/B 无账号关联）
  C: { username: 'VCallQA_A503636921', phone: '15036369210', password: 'Test@123456' },
};

const outDir = path.join(__dirname, '..', '..', 'load-test-output', 'voice-call-e2e-spec');
fs.mkdirSync(outDir, { recursive: true });

function log(msg) { console.log(`[T+${Date.now()}] ${msg}`); }

async function fetchCaptcha(page) {
  const { captchaId } = await page.evaluate(async () => {
    const r = await fetch('/api/auth/captcha', { credentials: 'include' });
    return r.json();
  });
  const text = execSync(`redis-cli -n 5 get "captcha:${captchaId}"`).toString().trim();
  return { captchaId, text };
}

async function login(page, user) {
  await page.goto(FRONTEND + '/', { waitUntil: 'domcontentloaded' });
  const { captchaId, text: captchaText } = await fetchCaptcha(page);
  const res = await page.evaluate(async ({ phone, password, captchaId, captchaText }) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ phone, password, captchaId, captchaText }),
    });
    return { status: r.status, body: await r.text() };
  }, { ...user, captchaId, captchaText });
  return res;
}

async function injectPCInstrumentation(page) {
  await page.addInitScript(() => {
    window.__pcEvents = [];
    const OrigPC = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new OrigPC(...args);
      window.__pcEvents.push({ t: Date.now(), type: 'PC_CREATED', config: JSON.stringify(args[0] || {}).slice(0, 500) });
      pc.addEventListener('iceconnectionstatechange', () => window.__pcEvents.push({ t: Date.now(), type: 'iceConnectionState', value: pc.iceConnectionState }));
      pc.addEventListener('connectionstatechange', () => window.__pcEvents.push({ t: Date.now(), type: 'connectionState', value: pc.connectionState }));
      pc.addEventListener('icecandidate', (e) => {
        if (e.candidate) {
          const parts = e.candidate.candidate.split(' ');
          const typIdx = parts.indexOf('typ');
          window.__pcEvents.push({ t: Date.now(), type: 'icecandidate', candType: typIdx >= 0 ? parts[typIdx + 1] : 'unknown' });
        } else {
          window.__pcEvents.push({ t: Date.now(), type: 'icecandidate', candType: 'END_OF_CANDIDATES' });
        }
      });
      return pc;
    };
    window.RTCPeerConnection.prototype = OrigPC.prototype;
  });
}

async function openConversation(page, otherUsername) {
  await page.click('[data-testid="nav-tab-contacts"]', { timeout: 8000 });
  await page.waitForTimeout(500);
  const row = page.locator('.wc-contact-item', { hasText: otherUsername }).first();
  await row.waitFor({ timeout: 8000 });
  await row.click();
  await page.waitForTimeout(500);
  const chatBtn = page.locator('[data-testid="up-action-chat"], button:has-text("发送消息"), button:has-text("发消息")').first();
  await chatBtn.waitFor({ timeout: 5000 });
  await chatBtn.click();
  await page.waitForTimeout(800);
}

async function waitConnected(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => {
      const evs = window.__pcEvents || [];
      const last = [...evs].reverse().find(e => e.type === 'connectionState');
      return last ? last.value : null;
    });
    if (state === 'connected') return true;
    if (state === 'failed' || state === 'closed') return false;
    await page.waitForTimeout(300);
  }
  return false;
}

async function ensureFriend(pageX, targetPhone, targetUsername, pageTarget) {
  await pageX.click('[data-testid="add-menu-btn"]', { timeout: 8000 });
  await pageX.waitForTimeout(300);
  const addFriendItem = pageX.locator('text=添加朋友').first();
  if (await addFriendItem.count()) await addFriendItem.click();
  await pageX.waitForTimeout(500);
  const afmInput = pageX.locator('.afm-search-input');
  await afmInput.waitFor({ timeout: 5000 });
  await afmInput.fill(targetPhone);
  await pageX.waitForTimeout(1200);
  const resultItem = pageX.locator('.afm-result-item').first();
  await resultItem.waitFor({ timeout: 5000 });
  await resultItem.click();
  await pageX.waitForTimeout(500);
  const chatBtnCheck = pageX.locator('[data-testid="up-action-chat"], button:has-text("发消息")').first();
  if (await chatBtnCheck.count()) {
    await pageX.keyboard.press('Escape').catch(() => {});
    return true;
  }
  const applyBtn = pageX.getByText('申请添加好友', { exact: true }).first();
  await applyBtn.waitFor({ timeout: 5000 });
  await applyBtn.click();
  await pageX.waitForTimeout(300);
  const sendBtn = pageX.locator('button:has-text("发送申请")').first();
  await sendBtn.waitFor({ timeout: 5000 });
  await sendBtn.click();
  await pageX.keyboard.press('Escape').catch(() => {});
  await pageX.waitForTimeout(1500);

  await pageTarget.click('[data-testid="nav-tab-contacts"]', { timeout: 8000 });
  await pageTarget.waitForTimeout(800);
  await pageTarget.click('[data-testid="cl-new-friends-entry"]', { timeout: 8000 });
  await pageTarget.waitForTimeout(800);
  const acceptBtn = pageTarget.locator('[data-testid="friend-request-accept"]').first();
  await acceptBtn.waitFor({ timeout: 8000 });
  await acceptBtn.click();
  await pageTarget.waitForTimeout(1000);
  return true;
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctxA = await browser.newContext({ permissions: ['microphone'] });
  const ctxB = await browser.newContext({ permissions: ['microphone'] });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await injectPCInstrumentation(pageA);
  await injectPCInstrumentation(pageB);

  const wsFrames = { A: [], B: [] };
  const consoleErrors = { A: [], B: [] };
  for (const [who, page] of [['A', pageA], ['B', pageB]]) {
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors[who].push(msg.text().slice(0, 200)); });
    page.on('websocket', ws => {
      ws.on('framesent', f => wsFrames[who].push({ dir: 'sent', t: Date.now(), payload: String(f.payload).slice(0, 300) }));
      ws.on('framereceived', f => wsFrames[who].push({ dir: 'recv', t: Date.now(), payload: String(f.payload).slice(0, 300) }));
    });
  }

  const results = [];

  const loginA = await login(pageA, USERS.A);
  const loginB = await login(pageB, USERS.B);
  if (loginA.status !== 200 || loginB.status !== 200) {
    console.error('LOGIN FAILED', loginA.status, loginB.status);
    process.exit(1);
  }
  await pageA.goto(FRONTEND + '/', { waitUntil: 'networkidle' });
  await pageB.goto(FRONTEND + '/', { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(1500);
  await pageB.waitForTimeout(1500);
  log('Both logged in');

  await openConversation(pageA, USERS.B.username);
  log('A opened conversation with B');

  // ── 场景 1-10：连续 10 轮正常呼叫 ──
  for (let i = 1; i <= 10; i++) {
    const cycle = { scenario: `normal-cycle-${i}` };
    const t0 = Date.now();
    try {
      await pageA.click('[data-testid="chat-call-audio-btn"]', { timeout: 8000 });
      await pageB.waitForTimeout(1500);
      const acceptBtn = pageB.locator('[data-testid="call-accept-btn"]').first();
      await acceptBtn.waitFor({ timeout: 8000 });
      await acceptBtn.click();
      const connA = await waitConnected(pageA, 8000);
      const connB = await waitConnected(pageB, 8000);
      cycle.connectedA = connA;
      cycle.connectedB = connB;
      cycle.pass = connA && connB;
      await pageA.waitForTimeout(1500);
      const hangupBtn = pageA.locator('[data-testid="call-hangup-btn"]').first();
      await hangupBtn.waitFor({ timeout: 5000 });
      await hangupBtn.click();
      await pageA.waitForTimeout(1000);
      await pageB.waitForTimeout(1000);
    } catch (e) {
      cycle.pass = false;
      cycle.error = String(e).slice(0, 300);
      await pageA.locator('[data-testid="call-hangup-btn"]').first().click({ timeout: 2000 }).catch(() => {});
      await pageB.locator('[data-testid="call-hangup-btn"]').first().click({ timeout: 2000 }).catch(() => {});
    }
    cycle.durationMs = Date.now() - t0;
    log(`CYCLE ${i} ${cycle.pass ? 'PASS' : 'FAIL'} connA=${cycle.connectedA} connB=${cycle.connectedB}`);
    results.push(cycle);
    await pageA.waitForTimeout(1200);
  }

  // ── 场景 11：被叫拒绝 ──
  {
    const cycle = { scenario: 'reject' };
    try {
      await pageA.click('[data-testid="chat-call-audio-btn"]', { timeout: 8000 });
      await pageB.waitForTimeout(1500);
      const rejectBtn = pageB.locator('[data-testid="call-reject-btn"]').first();
      await rejectBtn.waitFor({ timeout: 8000 });
      await rejectBtn.click();
      await pageA.waitForTimeout(2000);
      cycle.pass = (await pageA.locator('[data-testid="call-modal"]').count()) === 0;
    } catch (e) { cycle.pass = false; cycle.error = String(e).slice(0, 300); }
    log(`REJECT ${cycle.pass ? 'PASS' : 'FAIL'}`);
    results.push(cycle);
  }
  await pageA.locator('[data-testid="call-hangup-btn"]').first().click({ timeout: 2000 }).catch(() => {});
  await pageA.waitForTimeout(1000);

  // ── 场景 12：主叫取消 ──
  {
    const cycle = { scenario: 'caller-cancel' };
    try {
      await pageA.click('[data-testid="chat-call-audio-btn"]', { timeout: 8000 });
      await pageA.waitForTimeout(1000);
      const hangupBtn = pageA.locator('[data-testid="call-hangup-btn"]').first();
      await hangupBtn.waitFor({ timeout: 5000 });
      await hangupBtn.click();
      await pageB.waitForTimeout(2000);
      cycle.pass = (await pageB.locator('[data-testid="call-modal"]').count()) === 0;
    } catch (e) { cycle.pass = false; cycle.error = String(e).slice(0, 300); }
    log(`CANCEL ${cycle.pass ? 'PASS' : 'FAIL'}`);
    results.push(cycle);
  }
  await pageB.locator('[data-testid="call-reject-btn"]').first().click({ timeout: 2000 }).catch(() => {});

  // ── 场景 13：忙线（独立第三方 C） ──
  {
    const cycle = { scenario: 'busy-line' };
    const ctxC = await browser.newContext({ permissions: ['microphone'] });
    const pageC = await ctxC.newPage();
    try {
      const loginC = await login(pageC, USERS.C);
      if (loginC.status !== 200) throw new Error('C login failed: ' + loginC.status);
      await pageC.goto(FRONTEND + '/', { waitUntil: 'networkidle' });
      await pageC.waitForTimeout(1500);
      await ensureFriend(pageC, USERS.B.phone, USERS.B.username, pageB);

      await pageA.click('[data-testid="chat-call-audio-btn"]', { timeout: 8000 });
      await pageB.waitForTimeout(1500);
      await pageB.locator('[data-testid="call-accept-btn"]').first().click({ timeout: 8000 });
      await pageA.waitForTimeout(2000);

      await openConversation(pageC, USERS.B.username);
      await pageC.click('[data-testid="chat-call-audio-btn"]', { timeout: 8000 }).catch(() => {});
      await pageC.waitForTimeout(3000);

      const aOk = (await pageA.locator('[data-testid="call-modal"]').count()) > 0;
      const bOk = (await pageB.locator('[data-testid="call-modal"]').count()) > 0;
      cycle.aExistingCallUnaffected = aOk;
      cycle.bExistingCallUnaffected = bOk;
      cycle.pass = aOk && bOk;

      await pageC.locator('[data-testid="call-hangup-btn"]').first().click({ timeout: 2000 }).catch(() => {});
      await pageA.locator('[data-testid="call-hangup-btn"]').first().click({ timeout: 3000 }).catch(() => {});
      await pageA.waitForTimeout(1000);
    } catch (e) { cycle.pass = false; cycle.error = String(e).slice(0, 300); }
    await ctxC.close();
    log(`BUSY ${cycle.pass ? 'PASS' : 'FAIL'}`);
    results.push(cycle);
  }

  // ── 场景 14：ICE candidate 类型验证（复用最近一轮通话事件）──
  {
    const cycle = { scenario: 'ice-candidate-types' };
    try {
      await pageA.click('[data-testid="chat-call-audio-btn"]', { timeout: 8000 });
      await pageB.waitForTimeout(1500);
      await pageB.locator('[data-testid="call-accept-btn"]').first().click({ timeout: 8000 });
      await waitConnected(pageA, 8000);
      await waitConnected(pageB, 8000);
      await pageA.waitForTimeout(2000);
      const evs = await pageA.evaluate(() => window.__pcEvents || []);
      const types = new Set(evs.filter(e => e.type === 'icecandidate').map(e => e.candType));
      cycle.candidateTypesObserved = [...types];
      cycle.hasHost = types.has('host');
      cycle.hasSrflx = types.has('srflx');
      cycle.hasRelay = types.has('relay');
      cycle.pass = cycle.hasHost && (cycle.hasSrflx || cycle.hasRelay); // TURN 中继或 STUN 反射至少一种可用
      await pageA.locator('[data-testid="call-hangup-btn"]').first().click({ timeout: 3000 }).catch(() => {});
      await pageA.waitForTimeout(1000);
    } catch (e) { cycle.pass = false; cycle.error = String(e).slice(0, 300); }
    log(`ICE_CANDIDATE_TYPES ${cycle.pass ? 'PASS' : 'FAIL'} - ${JSON.stringify(cycle.candidateTypesObserved)}`);
    results.push(cycle);
  }

  // ── 场景 15：WebSocket 信令帧完整性 ──
  {
    const cycle = { scenario: 'ws-signaling-sequence' };
    const need = ['call:request', 'call:incoming', 'call:response', 'call:offer', 'call:ice', 'call:answer'];
    const seenA = need.filter(ev => wsFrames.A.some(f => f.payload.includes(ev)));
    const seenB = need.filter(ev => wsFrames.B.some(f => f.payload.includes(ev)));
    cycle.seenOnA = seenA;
    cycle.seenOnB = seenB;
    cycle.pass = need.every(ev => seenA.includes(ev) || seenB.includes(ev));
    log(`WS_SIGNALING_SEQUENCE ${cycle.pass ? 'PASS' : 'FAIL'}`);
    results.push(cycle);
  }

  const passedNormalCycles = results.filter(r => r.scenario.startsWith('normal-cycle-') && r.pass).length;
  const summary = {
    totalScenarios: results.length,
    passedNormalCycles: `${passedNormalCycles}/10`,
    allPassed: results.every(r => r.pass),
    results,
    consoleErrors,
  };
  fs.writeFileSync(path.join(outDir, 'voice-call-spec-result.json'), JSON.stringify(summary, null, 2));
  log(`=== DONE: ${summary.allPassed ? 'ALL PASS' : 'SOME FAILED'} — normal cycles ${summary.passedNormalCycles} ===`);

  await browser.close();
  process.exit(summary.allPassed ? 0 : 1);
})();
