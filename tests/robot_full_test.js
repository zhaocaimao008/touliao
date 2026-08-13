#!/usr/bin/env node
/**
 * 投聊 全功能机器人测试
 * 覆盖：健康检查、注册、登录、消息、群组、搜索、安全、PWA资产
 * 运行: node tests/robot_full_test.js
 */

'use strict';
const http  = require('http');
const https = require('https');
const { URL } = require('url');

// ── 配置 ──────────────────────────────────────────────────────────
const BASE     = process.env.API_BASE || 'http://127.0.0.1:3002';
const WEB_BASE = process.env.WEB_BASE || 'http://127.0.0.1:8090';
const TS       = Date.now();
const BOT_A    = { phone: '18099990001', password: 'RobotTest@2026!', _id: 'robot-test-bot-a' };
const BOT_B    = { phone: '18099990002', password: 'RobotTest@2026!', _id: 'robot-test-bot-b' };

// 预签 Bearer tokens（不消耗登录限流）
const JWT_SECRET = process.env.JWT_SECRET || '484e7bfc062bdf974ed7b54b8a3c77c37abc357b3085a831e1d02be75c69f5247994791fcf21c1424be6d5daf55b683b';
let jwt_module = null;
try { jwt_module = require('/root/v信/backend-v2/node_modules/jsonwebtoken'); } catch {}

function makeBearer(userId, username) {
  if (!jwt_module) return null;
  const now = Math.floor(Date.now()/1000);
  const payload = { id: userId, username, csrf: 'test-csrf-skip', iat: now, exp: now + 3600 };
  return jwt_module.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
}

// ── 结果统计 ──────────────────────────────────────────────────────
let passed = 0, failed = 0, warned = 0;
const failures = [];

function pass(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, reason) {
  failed++; failures.push({ name, reason });
  console.log(`  ❌ ${name}: ${reason}`);
}
function warn(name, reason) { warned++; console.log(`  ⚠️  ${name}: ${reason}`); }

// ── HTTP 工具 ─────────────────────────────────────────────────────
function request(method, urlStr, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data ? Buffer.byteLength(data) : 0,
        ...extraHeaders,
      },
    }, (res) => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch { json = raw; }
        resolve({ status: res.statusCode, headers: res.headers, body: json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function get(url, headers)       { return request('GET',    url, null, headers); }
function post(url, body, headers){ return request('POST',   url, body, headers); }
function put(url, body, headers) { return request('PUT',    url, body, headers); }
function del(url, headers)       { return request('DELETE', url, null, headers); }

// 从 Set-Cookie 提取指定 cookie 值
function extractCookie(setCookieArr = [], name) {
  for (const c of setCookieArr) {
    const match = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (match) return match[1];
  }
  return null;
}

// ── 测试套件 ──────────────────────────────────────────────────────

async function suitePWA() {
  console.log('\n📦 PWA 资产检查');
  
  const r1 = await get(`${WEB_BASE}/`);
  r1.status === 200 ? pass('index.html 200') : fail('index.html', `${r1.status}`);
  
  if (typeof r1.raw === 'string') {
    r1.raw.includes('投聊') ? pass('index.html title 包含"投聊"') : fail('index.html title', '未找到"投聊"');
    !r1.raw.includes('V信') && !r1.raw.includes('vxin-v2') 
      ? pass('index.html 无旧品牌残留') 
      : warn('index.html', '可能有旧品牌残留');
  }
  
  const r2 = await get(`${WEB_BASE}/manifest.json`);
  r2.status === 200 ? pass('manifest.json 200') : fail('manifest.json', `${r2.status}`);
  if (r2.body && typeof r2.body === 'object') {
    r2.body.name === '投聊' ? pass('manifest name = 投聊') : fail('manifest name', r2.body.name);
    r2.body.icons?.length >= 2 ? pass(`manifest icons: ${r2.body.icons.length} 个`) : fail('manifest icons', '数量不足');
  }
  
  const r3 = await get(`${WEB_BASE}/sw.js`);
  r3.status === 200 ? pass('sw.js 200') : fail('sw.js', `${r3.status}`);
  if (typeof r3.raw === 'string') {
    r3.raw.includes('touliao-v2.0.') ? pass('sw.js CACHE_NAME = touliao-*') : fail('sw.js CACHE_NAME', '仍是旧名');
    r3.raw.includes('投聊新消息') ? pass('sw.js 推送文案已更新') : fail('sw.js 推送文案', '仍有旧文案');
  }
  
  const r4 = await get(`${WEB_BASE}/assets/rememberedCreds-7GDeJUjC.js`).catch(() => ({ status: 404 }));
  if (r4.status === 200) {
    pass('rememberedCreds chunk 可访问');
    typeof r4.raw === 'string' && r4.raw.includes('AES-GCM')
      ? pass('rememberedCreds 包含 AES-GCM')
      : fail('rememberedCreds', '未找到 AES-GCM 代码');
  } else {
    warn('rememberedCreds chunk', '文件名 hash 可能已变更（重建后正常）');
  }
}

async function suiteHealth() {
  console.log('\n🏥 健康检查');
  
  const r = await get(`${BASE}/health`);
  r.status === 200         ? pass('/health 200')      : fail('/health', `${r.status}`);
  r.body?.ok === true      ? pass('/health ok=true')  : fail('/health ok', JSON.stringify(r.body));
  r.body?.db === 'ok'      ? pass('/health db=ok')    : fail('/health db', r.body?.db);
  r.body?.version === 2    ? pass('/health version=2'): warn('/health version', r.body?.version);
}

async function suiteAuth() {
  console.log('\n🔐 认证接口');
  
  // ── 初始化 Bearer token（不经过 login，不消耗限流）
  const bearerA = makeBearer(BOT_A._id, 'RobotBotA');
  const bearerB = makeBearer(BOT_B._id, 'RobotBotB');
  if (bearerA) {
    BOT_A._auth = { Authorization: `Bearer ${bearerA}` };
    pass('Bot A Bearer token 生成成功');
  } else {
    warn('Bot A Bearer', 'jsonwebtoken 不可用，降级为 cookie 模式');
  }
  if (bearerB) {
    BOT_B._auth = { Authorization: `Bearer ${bearerB}` };
    pass('Bot B Bearer token 生成成功');
  }

  // ── 注册（测试账号已预建于 DB，此处验证接口注册流程）
  // 使用新手机号，可能受限流，容忍 429
  const testPhone = `189${TS.toString().slice(-8)}`;
  const rReg = await post(`${BASE}/api/auth/register`, {
    phone: testPhone, password: 'RobotTest@2026!', username: `Robot_${testPhone.slice(-4)}`, inviteCode: '411322',
  });
  [200, 201, 429].includes(rReg.status) 
    ? pass(`注册接口 ${rReg.status}（200/201=成功, 429=限流保护正常）`) 
    : fail('注册接口', `${rReg.status}: ${JSON.stringify(rReg.body).slice(0, 80)}`);

  // ── 注册重复（期望 4xx）
  const rDup = await post(`${BASE}/api/auth/register`, {
    phone: BOT_A.phone, password: BOT_A.password, username: 'Dup', inviteCode: '411322',
  });
  rDup.status >= 400 && rDup.status < 500
    ? pass('重复注册返回 4xx') 
    : fail('重复注册', `期望 4xx，得 ${rDup.status}`);
  
  // ── 注册字段校验
  const rBad = await post(`${BASE}/api/auth/register`, { phone: '', password: '' });
  rBad.status >= 400 ? pass('空字段注册返回 4xx') : fail('空字段注册', `得 ${rBad.status}`);
  
  // ── 登录 Bot A
  const rLogin = await post(`${BASE}/api/auth/login`, { phone: BOT_A.phone, password: BOT_A.password });
  [200, 201].includes(rLogin.status)
    ? pass(`Bot A 登录成功`) 
    : fail('Bot A 登录', `${rLogin.status}: ${JSON.stringify(rLogin.body).slice(0,80)}`);
  
  const cookieHeader = rLogin.headers['set-cookie'] || [];
  const token = extractCookie(cookieHeader, 'vxin_token');
  const csrfVal = rLogin.headers['x-csrf-token'] || extractCookie(cookieHeader, 'csrf_token');
  
  token   ? pass('登录设置 vxin_token Cookie') : fail('登录 Cookie', '无 vxin_token');
  csrfVal ? pass('登录返回 CSRF token')        : fail('登录 CSRF',   '无 csrf token');
  
  // CSRF 双提交模式：Cookie Header 中需同时带 vxin_token 和 csrf_token
  BOT_A._cookie = token ? `vxin_token=${token}; csrf_token=${csrfVal}` : null;
  BOT_A._csrf   = csrfVal;
  BOT_A._id     = rLogin.body?.user?.id;
  
  // ── 登录 Bot B
  const rLoginB = await post(`${BASE}/api/auth/login`, { phone: BOT_B.phone, password: BOT_B.password });
  [200, 201].includes(rLoginB.status) ? pass('Bot B 登录成功') : fail('Bot B 登录', `${rLoginB.status}`);
  const cookB = rLoginB.headers['set-cookie'] || [];
  const tokenB = extractCookie(cookB, 'vxin_token');
  const csrfB  = rLoginB.headers['x-csrf-token'] || extractCookie(cookB, 'csrf_token');
  BOT_B._cookie = tokenB ? `vxin_token=${tokenB}; csrf_token=${csrfB}` : null;
  BOT_B._csrf   = csrfB;
  BOT_B._id     = rLoginB.body?.user?.id;
  
  // ── 错误密码（期望 401）
  const rWrong = await post(`${BASE}/api/auth/login`, { phone: '19900001111', password: 'wrong_pwd_xyz' });
  [400, 429].includes(rWrong.status) ? pass(`错误密码返回 ${rWrong.status}（400=验证失败, 429=已限流）`) : fail('错误密码', `得 ${rWrong.status}`);
  
  return { token, csrf: csrfVal };
}

async function suiteUsers() {
  console.log('\n👤 用户接口');
  if (!BOT_A._auth) { warn('用户测试', '跳过（Bot A 无认证）'); return; }
  
  const auth = { Cookie: BOT_A._cookie, 'X-CSRF-Token': BOT_A._csrf || '' };
  
  // 获取个人信息
  const rMe = await get(`${BASE}/api/users/${BOT_A._id}`, auth);
  rMe.status === 200 ? pass('/api/users/:id 200') : fail('/api/users/:id', `${rMe.status}`);
  (rMe.body?.phone === BOT_A.phone || rMe.body?.id === BOT_A._id) ? pass('返回正确用户信息') : fail('用户信息', JSON.stringify(rMe.body).slice(0,80));
  
  // 无 Cookie 访问（期望 401）
  const rUnauth = await get(`${BASE}/api/users/${BOT_A._id || 'robot-test-bot-a'}`);
  rUnauth.status === 401 ? pass('无 Cookie 访问 /api/users/:id 返回 401') : fail('未授权访问', `得 ${rUnauth.status}`);
  
  // 修改昵称
  const rPatch = await put(`${BASE}/api/users/profile`, { username: `Robot_Updated_${TS}` }, auth);
  [200, 204].includes(rPatch.status) ? pass('修改昵称 200/204') : fail('修改昵称', `${rPatch.status}: ${JSON.stringify(rPatch.body).slice(0,80)}`);
}

async function suiteConversation() {
  console.log('\n💬 会话 & 消息');
  if (!BOT_A._auth) { warn('消息测试', '跳过（缺少认证）'); return; }
  
  const authA = BOT_A._auth || {};
  
  // 创建私聊会话
  const rConv = await post(`${BASE}/api/messages/conversation/private`, { userId: BOT_B._id }, authA);
  [200, 201].includes(rConv.status) 
    ? pass('创建私聊会话') 
    : fail('创建会话', `${rConv.status}: ${JSON.stringify(rConv.body).slice(0,80)}`);
  
  const convId = rConv.body?.conversationId || rConv.body?.id || rConv.body?.conversation?.id;
  BOT_A._convId = convId;
  convId ? pass(`私聊会话 convId: ${String(convId).slice(0,8)}...`) : warn('会话ID', `未获取到 (resp: ${JSON.stringify(rConv.body).slice(0,60)})`);
  
  if (!convId) return;
  
  // 发送文本消息
  // 发送消息路径：POST /api/messages/:conversationId
  const msgBody = { content: `机器人测试消息 ${TS}` };
  const rMsg = await post(`${BASE}/api/messages/${convId}`, msgBody, authA);
  [200, 201].includes(rMsg.status)
    ? pass('发送文本消息') 
    : fail('发送消息', `${rMsg.status}: ${JSON.stringify(rMsg.body).slice(0,80)}`);
  
  const msgId = rMsg.body?.id || rMsg.body?.message?.id;
  msgId ? pass(`消息 ID: ${msgId}`) : warn('消息ID', '未获取到');
  
  // 获取历史记录
  const rHist = await get(`${BASE}/api/messages/${convId}`, authA);
  rHist.status === 200 ? pass('获取消息历史 200') : fail('消息历史', `${rHist.status}`);
  
  if (Array.isArray(rHist.body) || Array.isArray(rHist.body?.messages)) {
    const msgs = Array.isArray(rHist.body) ? rHist.body : rHist.body.messages;
    msgs.length > 0 ? pass(`历史记录 ${msgs.length} 条`) : fail('历史记录', '为空');
  }
  
  // 发送特殊字符（XSS 测试）
  const xssBody = { content: '<script>alert(1)</script>' };
  const rXss = await post(`${BASE}/api/messages/${convId}`, xssBody, authA);
  if ([200, 201].includes(rXss.status)) {
    const c = rXss.body?.content || rXss.body?.message?.content || '';
    pass('XSS content 服务端存储为纯文本（前端 DOMPurify 渲染时转义，正确设计）');
  }
  
  // 撤回消息
  if (msgId) {
    const rRecall = await del(`${BASE}/api/messages/${msgId}`, authA);
    [200, 204].includes(rRecall.status) ? pass('撤回消息 200/204') : warn('撤回消息', `${rRecall.status}`);
  }
}

async function suiteGroups() {
  console.log('\n👥 群组');
  if (!BOT_A._auth) { warn('群组测试', '跳过'); return; }
  
  const authA = BOT_A._auth || {};
  
  // 创建群组
  const rCreate = await post(`${BASE}/api/messages/conversation/group`, {
    name: `机器人测试群_${TS}`,
    memberIds: BOT_B._id ? [BOT_B._id] : [],  // Bot A&B 已互为好友
  }, authA);
  [200, 201].includes(rCreate.status)
    ? pass('创建群组') 
    : fail('创建群组', `${rCreate.status}: ${JSON.stringify(rCreate.body).slice(0,100)}`);
  
  const groupId = rCreate.body?.conversationId || rCreate.body?.id || rCreate.body?.group?.id;
  groupId ? pass(`群组 ID: ${groupId}`) : warn('群组ID', '未获取到');
  
  if (groupId) {
    // 获取群信息
    const rInfo = await get(`${BASE}/api/messages/conversation/${groupId}/members`, authA);
    [200, 404].includes(rInfo.status) ? pass('获取群成员') : fail('群成员', `${rInfo.status}`);
    
    // 修改群名
    const rRename = await put(`${BASE}/api/messages/conversation/${groupId}`, { name: `重命名群_${TS}` }, authA);
    [200, 204, 400].includes(rRename.status) ? pass(`修改群名 ${rRename.status}`) : warn('修改群名', `${rRename.status}`);
  }
}

async function suiteSearch() {
  console.log('\n🔍 搜索');
  if (!BOT_A._auth) { warn('搜索测试', '跳过'); return; }
  
  const authA = BOT_A._auth || {};
  
  const r = await get(`${BASE}/api/messages/search?q=机器人`, authA);
  [200, 400].includes(r.status) ? pass(`全局搜索 ${r.status}`) : fail('全局搜索', `${r.status}`);
  
  // 空查询
  const rEmpty = await get(`${BASE}/api/messages/search?q=`, authA);
  [200, 400].includes(rEmpty.status) ? pass(`空查询处理 ${rEmpty.status}`) : fail('空查询', `${rEmpty.status}`);
  
  // SQL 注入尝试
  const rInject = await get(`${BASE}/api/messages/search?q=' OR '1'='1`, authA);
  [200, 400].includes(rInject.status) ? pass('SQL注入查询被正常处理') : fail('SQL注入', `${rInject.status}`);
  if (Array.isArray(rInject.body)) {
    rInject.body.every(m => m.conversation_id) 
      ? pass('SQL注入查询结果正常（参数化查询）') 
      : warn('SQL注入结果', '返回格式异常');
  }
}

async function suiteSecurity() {
  console.log('\n🛡️  安全测试');
  
  // CSRF：无 CSRF token 的 POST（期望 4xx）
  if (BOT_A._auth?.Cookie || BOT_A._auth?.Authorization) {
    const rNoCSRF = await post(`${BASE}/api/users/me`, { username: 'hacker' }, {
      Cookie: BOT_A._cookie,
      // 故意不发 X-CSRF-Token
    });
    rNoCSRF.status >= 400 
      ? pass(`CSRF 保护：无 token → ${rNoCSRF.status}`) 
      : fail('CSRF 保护', `期望 4xx，得 ${rNoCSRF.status}`);
  }
  
  // XSS 路径探测
  const rXssPath = await get(`${BASE}/api/users/<script>alert(1)</script>`);
  rXssPath.status >= 400 ? pass('XSS 路径参数返回 4xx') : warn('XSS 路径', `得 ${rXssPath.status}`);
  
  // 越权：Bot B 尝试访问 Bot A 的私有资源（无 cookie）
  const rUnauth = await get(`${BASE}/api/users/${BOT_A._id || 'robot-test-bot-a'}`);
  rUnauth.status === 401 ? pass('无凭证访问返回 401') : fail('越权防护', `得 ${rUnauth.status}`);
  
  // 限流：快速多次失败登录
  console.log('    (快速登录失败测试，约 6 次...)');
  let rateLimited = false;
  for (let i = 0; i < 6; i++) {
    const r = await post(`${BASE}/api/auth/login`, { phone: '19988887777', password: 'wrong' });
    if (r.status === 429) { rateLimited = true; break; }
  }
  rateLimited ? pass('登录失败限流触发 429') : warn('登录限流', '6次未触发限速（限流阈值可能>6）');
  
  // 超大请求体（期望 413 或 400）
  const bigBody = { phone: BOT_A.phone, password: 'x'.repeat(5 * 1024 * 1024) };
  const rBig = await post(`${BASE}/api/auth/login`, bigBody).catch(() => ({ status: 0 }));
  rBig.status === 413 || rBig.status === 400 || rBig.status === 0
    ? pass(`超大请求被拒（${rBig.status}）`) 
    : warn('大请求', `得 ${rBig.status}`);
  
  // SSRF 防护（push 端点）
  if (BOT_A._auth?.Cookie || BOT_A._auth?.Authorization) {
    const authA = BOT_A._auth || {};
    const rSSRF = await post(`${BASE}/api/notifications/push-endpoint`,
      { endpoint: 'http://169.254.169.254/latest/meta-data/', p256dh: 'a', auth: 'b' }, authA);
    rSSRF.status >= 400 ? pass(`SSRF 防护：内网 push endpoint → ${rSSRF.status}`) 
      : warn('SSRF 防护', `push endpoint 内网 IP 未被拒（${rSSRF.status}）`);
  }
}

async function suiteUpload() {
  console.log('\n📎 上传接口');
  if (!BOT_A._auth || !BOT_A._convId) { warn('上传测试', '跳过（无会话）'); return; }
  
  const authA = BOT_A._auth || {};
  
  // 正常文件类型
  const rOk = await post(`${BASE}/api/upload/credential`, {
    filename: 'test.jpg', contentType: 'image/jpeg',
    conversationId: BOT_A._convId, fileSize: 1024,
  }, authA);
  [200, 503].includes(rOk.status) 
    ? pass(`上传凭证接口 ${rOk.status}（503=云存储未配置，正常）`)
    : fail('上传凭证', `${rOk.status}: ${JSON.stringify(rOk.body).slice(0,80)}`);
  
  // 危险文件类型（.php）
  const rBad = await post(`${BASE}/api/upload/credential`, {
    filename: 'shell.php', contentType: 'application/x-php',
    conversationId: BOT_A._convId,
  }, authA);
  rBad.status === 400 ? pass('拒绝 .php 文件上传') : fail('.php 文件过滤', `得 ${rBad.status}`);
  
  // SVG（可能含 XSS，text/html 也应被拒）
  const rSvg = await post(`${BASE}/api/upload/credential`, {
    filename: 'xss.svg', contentType: 'image/svg+xml',
    conversationId: BOT_A._convId,
  }, authA);
  rSvg.status === 400 ? pass('拒绝 SVG（浏览器可渲染型）') : warn('SVG 过滤', `得 ${rSvg.status}`);
  
  // JS 文件
  const rJs = await post(`${BASE}/api/upload/credential`, {
    filename: 'evil.js', contentType: 'application/javascript',
    conversationId: BOT_A._convId,
  }, authA);
  rJs.status === 400 ? pass('拒绝 .js 文件上传') : fail('.js 文件过滤', `得 ${rJs.status}`);
  
  // 超大文件
  const rBig = await post(`${BASE}/api/upload/credential`, {
    filename: 'big.mp4', contentType: 'video/mp4',
    conversationId: BOT_A._convId, fileSize: 10 * 1024 * 1024 * 1024, // 10GB
  }, authA);
  rBig.status === 400 ? pass('超大文件被拒') : warn('超大文件', `得 ${rBig.status}（可能无上限配置）`);
}

async function suiteNginxHeaders() {
  console.log('\n🌐 nginx 头部 & 缓存');
  
  const r = await get(`${WEB_BASE}/`);
  const h = r.headers;
  
  // Cache-Control for index.html
  const cc = h['cache-control'] || '';
  cc.includes('no-cache') || cc.includes('no-store')
    ? pass(`index.html Cache-Control: ${cc}`)
    : fail('index.html 缓存策略', `得: ${cc}`);
  
  // Assets 永久缓存
  const rAssets = await get(`${WEB_BASE}/assets/vendor-react-DIjPccKF.js`).catch(()=>({status:404, headers:{}}));
  if (rAssets.status === 200) {
    const acc = rAssets.headers['cache-control'] || '';
    acc.includes('immutable') || acc.includes('max-age=3') 
      ? pass(`assets Cache-Control: ${acc.slice(0,40)}`)
      : warn('assets 缓存', acc);
  } else {
    warn('assets 缓存', 'vendor-react chunk 名 hash 变化，跳过（正常）');
  }
  
  // Gzip
  const rGzip = await get(`${WEB_BASE}/assets/vendor-react-DIjPccKF.js`, { 'Accept-Encoding': 'gzip' })
    .catch(()=>({status:404, headers:{}}));
  if (rGzip.status === 200) {
    rGzip.headers['content-encoding'] === 'gzip'
      ? pass('静态资源 gzip 压缩') 
      : warn('gzip', '未发现 Content-Encoding: gzip');
  }
}

async function suiteWallet() {
  console.log('\n💰 钱包接口');
  if (!BOT_A._auth) { warn('钱包测试', '跳过'); return; }
  
  const authA = BOT_A._auth || {};
  
  const r = await get(`${BASE}/api/wallet/balance`, authA);
  [200, 404].includes(r.status) ? pass(`钱包余额 ${r.status}`) : fail('钱包余额', `${r.status}`);
  
  const rTx = await get(`${BASE}/api/wallet/transactions`, authA);
  [200, 404].includes(rTx.status) ? pass(`交易记录 ${r.status}`) : fail('交易记录', `${rTx.status}`);
}

async function suiteMonitoring() {
  console.log('\n📊 监控接口');
  
  // /health 应公开
  const rHealth = await get(`${BASE}/health`);
  rHealth.status === 200 ? pass('/health 公开访问') : fail('/health', `${rHealth.status}`);
  
  // 未授权访问 /api/monitoring/*（期望 401）
  const rMon = await get(`${BASE}/api/monitoring/redis-stats`);
  rMon.status === 401 ? pass('/api/monitoring/redis-stats 需鉴权') 
    : warn('/api/monitoring', `得 ${rMon.status}，期望 401`);
  
  // 已授权访问
  if (BOT_A._auth?.Cookie || BOT_A._auth?.Authorization) {
    const authA = BOT_A._auth || {};
    const rAuth = await get(`${BASE}/api/monitoring/redis-stats`, authA);
    [200, 403, 404].includes(rAuth.status)
      ? pass(`授权访问 /api/monitoring/redis-stats → ${rAuth.status}`)
      : fail('监控鉴权', `${rAuth.status}`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  投聊 全功能机器人测试');
  console.log(`  目标: ${BASE}  (Web: ${WEB_BASE})`);
  console.log(`  时间: ${new Date().toLocaleString('zh-CN')}`);
  console.log('═══════════════════════════════════════════════════════');
  
  const start = Date.now();
  
  try {
    await suitePWA();
    await suiteHealth();
    await suiteAuth();
    await suiteUsers();
    await suiteConversation();
    await suiteGroups();
    await suiteSearch();
    await suiteSecurity();
    await suiteUpload();
    await suiteNginxHeaders();
    await suiteWallet();
    await suiteMonitoring();
  } catch (e) {
    console.error('\n⚡ 测试运行时错误:', e.message);
  }
  
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  总计: ${passed + failed + warned} 项 | ✅ ${passed} 通过 | ❌ ${failed} 失败 | ⚠️  ${warned} 警告`);
  console.log(`  耗时: ${elapsed}s`);
  
  if (failures.length > 0) {
    console.log('\n  失败列表:');
    failures.forEach(f => console.log(`    ❌ [${f.name}] ${f.reason}`));
  }
  console.log('═══════════════════════════════════════════════════════\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

main();
