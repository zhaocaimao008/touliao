'use strict';
const http=require('http'),path=require('path'),fs=require('fs'),assert=require('assert/strict');
const {chromium}=require('../../tests/node_modules/playwright');
(async()=>{
  require('./testEnv');let handler;const server=http.createServer((q,s)=>handler(q,s));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;process.env.CORS_ORIGINS=base;process.env.APP_URL=base;
  const {app,makeUser,befriend,privateConversation}=require('./helpers'),express=require('express'),frontend=express();
  frontend.use((q,s,n)=>/^\/(api|uploads|health)(\/|$)/.test(q.url)?app(q,s):n());frontend.use(express.static(path.resolve(__dirname,'../../web/dist')));frontend.get('*',(_q,s)=>s.sendFile(path.resolve(__dirname,'../../web/dist/index.html')));handler=frontend;
  const io=new(require('socket.io').Server)(server);app.set('io',io);require('../src/realtime')(io,app);
  const messages=require('../src/modules/messages/messages.service'),{db,readDb}=require('../src/db/connection');let browser;
  try{
    const a=await makeUser({username:'Browser phase two'}),b=await makeUser({username:'Audit peer'});await befriend(a,b);const cid=await privateConversation(a,b);await messages.send(io,cid,b.userId,{content:'browser seeded conversation',type:'text'});
    browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});const context=await browser.newContext({viewport:{width:1280,height:800}});await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.__auditPerf={lcp:0,cls:0};new PerformanceObserver(l=>{for(const e of l.getEntries())window.__auditPerf.lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__auditPerf.cls+=e.value;}).observe({type:'layout-shift',buffered:true});});
    await page.goto(base);await page.getByTestId('login-phone-input').fill(a.phone);await page.getByTestId('login-password-input').fill(a.password);await page.getByTestId('login-submit-btn').click();await page.getByText('Audit peer',{exact:true}).first().click();
    const input=page.locator('textarea').first();await input.waitFor({state:'visible'});await input.fill('browser emoji regression 😀');await input.press('Enter');await page.waitForFunction(()=>document.body.textContent.includes('browser emoji regression 😀'));
    for(let i=0;i<50&&!db.prepare('SELECT 1 FROM messages WHERE conversation_id=? AND content=?').get(cid,'browser emoji regression 😀');i++)await new Promise(r=>setTimeout(r,100));assert.equal(db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND content=?').get(cid,'browser emoji regression 😀').n,1);
    await context.setOffline(true);await messages.send(io,cid,b.userId,{content:'offline recovery regression',type:'text'});await context.setOffline(false);await page.waitForFunction(()=>document.body.textContent.includes('offline recovery regression'),{},{timeout:20000});
    assert.equal(await page.evaluate(()=>fetch('/api/auth/refresh',{method:'POST'}).then(r=>r.status)),200);assert.equal(await page.evaluate(()=>fetch('/api/auth/me').then(r=>r.status)),200);
    await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
    const perf=await page.evaluate(()=>({...window.__auditPerf,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime}));console.log('BROWSER_PHASE2_RESULT '+JSON.stringify({login:true,textAndEmoji:true,onePersistedMessage:true,offlineRecovery:true,refresh:true,mobileWidth390:true,pageErrors:errors,perf}));
  }finally{
    await browser?.close();await new Promise(r=>io.close(r));await new Promise(r=>server.close(r));require('../src/integrations/tracing').stopCleanup();require('../src/utils/fcmOptimized').stopCleanup();require('../src/utils/auditLogger').auditLogger.stopCleanup();require('../src/utils/queryOptimizer').queryCache.stopCleanup();
    await require('../src/db/writer').shutdown();await require('../src/realtime/securityEvents').close();await require('../src/utils/tokenBlacklist').close();await require('../src/utils/cache').close();await require('../src/middleware/rateLimiters').close();readDb.close();db.close();const{TEST_DB,TEST_UPLOADS}=require('./testEnv');for(const x of['','-wal','-shm'])fs.rmSync(TEST_DB+x,{force:true});fs.rmSync(TEST_UPLOADS,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
