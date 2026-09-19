const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
// Isolated application UI fixtures. No external APIs or production writes.
const http=require('http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const {fixture}=require('./windows-ui-smoke.cjs');
const O=path.resolve(process.env.UI_OUTPUT || 'artifacts/icon-review');fs.mkdirSync(O,{recursive:true});
const root=path.resolve(process.env.UI_BUILD || 'web/dist'); const results=[];
const browserOptions={headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),...(process.env.CHROMIUM_CHANNEL?{channel:process.env.CHROMIUM_CHANNEL}:{})};
const platforms=process.env.ICON_REVIEW_PLATFORMS==='win32'?[['win32',1200]]:[['web',1200],['web',390],['win32',1200]];
async function serverFor(root){const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.json':'application/json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res)});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,base:'http://127.0.0.1:'+server.address().port}}
const boxes=async page=>page.evaluate(()=>[...document.querySelectorAll('svg')].map(s=>{const b=s.getBoundingClientRect(),c=getComputedStyle(s),p=s.closest('button,[role="button"],label,a'),target=p?.getBoundingClientRect();let ink;try{const g=s.getBBox();ink=[g.x,g.y,g.width,g.height]}catch{}return {semantic:s.dataset.icon,size:[b.width,b.height],ink,label:p?.getAttribute('aria-label')||p?.getAttribute('title'),target:target?[target.width,target.height]:null,strokeWidth:c.strokeWidth,linecap:c.strokeLinecap,linejoin:c.strokeLinejoin,color:c.color,fill:c.fill}}).filter(x=>x.size[0]>0&&x.size[1]>0));
(async()=>{const srv=await serverFor(root),browser=await chromium.launch(browserOptions);
try {for(const [platform,width] of platforms)for(const theme of ['light','dark']){
 const f=await fixture(browser,srv.base,{platform,width,height:850,skin:'touliao',theme}); const p=f.page;p.setDefaultTimeout(6000);
 const snap=async(scene)=>{await p.mouse.move(0,0);await p.waitForTimeout(250);const icons=await boxes(p);assert.deepEqual(f.errors,[],scene);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,scene+' overflow');
 const filename=`${platform}-${width}-${theme}-${scene}.png`;await p.screenshot({path:path.join(O,filename)});results.push({platform,width,theme,scene,filename,icons});console.log('PASS',filename);};
 try {
 await snap('home');
 await p.getByTestId('conv-item-ui-0').click(); await p.locator('.wc-msg-bubble').first().waitFor();await snap('chat');
 await p.locator('.wc-msg-avatar').first().dblclick(); await p.locator('.up-close-btn').waitFor();await snap('user-profile');await p.locator('.up-close-btn').click();
 const size=await p.locator('.wc-tool-btn svg.tl-icon').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));assert.ok(size.every(s=>s===24),'toolbar glyphs must all be 24');
 if(width===390) assert.ok((await p.getByTestId('chat-send-btn').boundingBox()).height>=44,'mobile send target');
 await p.locator('.wc-tool-btn').filter({has:p.locator('[data-icon="more"]')}).click(); await p.locator('.wc-more-item').first().waitFor();await snap('more-panel');
 assert.equal(await p.locator('.wc-more-item').filter({hasText:'文件'}).locator('svg').getAttribute('data-icon'),'file');
 await p.locator('.wc-tool-btn').filter({has:p.locator('[data-icon="more"]')}).click();
 await p.locator('.wc-tool-btn').filter({has:p.locator('[data-icon="emoji"]')}).click();await snap('emoji');
 await p.locator('.wc-tool-btn').filter({has:p.locator('[data-icon="emoji"]')}).click();
 await p.locator('.wc-msg-bubble').first().click({button:'right'});await p.getByTestId('ctx-copy').waitFor();await snap('context-menu');
 assert.equal(await p.getByTestId('ctx-copy').locator('svg').getAttribute('data-icon'),'copy');await p.keyboard.press('Escape');await p.locator('.wc-chat-header').click({position:{x:180,y:20}}).catch(()=>{});
 for(const type of ['audio','video']){f.emitSocket('call:incoming',{from:'peer-0',type,caller:{name:'林晓'},callId:'icon-'+type});await p.getByTestId('call-reject-btn').waitFor();await snap('incoming-'+type);const cs=await p.locator('.cm-circle-btn-icon svg').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().width));assert.ok(cs.every(s=>s===24),'call glyphs24');await p.getByTestId('call-reject-btn').click();await p.getByTestId('call-reject-btn').waitFor({state:'hidden'});}
 // File bubble fixture stays within the isolated HTTP interceptor.
 await f.context.route(/\/api\/messages\/ui-0(?:\?|$)/,r=>r.fulfill({json:[{id:'icon-file',conversation_id:'ui-0',sender_id:'ui-me',senderName:'界面体验',type:'file',content:'icon-review.txt',file_url:srv.base+'/icon-review.txt',file_size:99,created_at:Math.floor(Date.now()/1000)}]}));
 await p.reload();await p.getByTestId('conv-item-ui-0').click();await p.locator('.wc-msg-file-icon').waitFor();await snap('file-message');
 assert.equal(await p.locator('.wc-msg-file-icon svg').evaluate(e=>getComputedStyle(e).fill),'none');
 await f.context.route('**/icon-review.txt*',r=>r.fulfill({contentType:'text/plain',body:'Touliao icon review file fixture'}));
 await p.getByTestId('msg-file').click();await p.getByTestId('file-preview-close').waitFor();await snap('file-preview');await p.getByTestId('file-preview-close').click();
 if(width===390){await p.locator('.wc-chat-header-back').click();}
 await p.getByTestId('conv-item-ui-1').click(); await p.locator('.wc-msg-bubble').first().waitFor();
 await p.getByTestId('chat-group-info-btn').click();await snap('group-info');
 if(width===390) {await p.locator('.gi-close-btn').click().catch(()=>{});await p.locator('.wc-chat-header-back').click();}
 await p.getByTestId('nav-tab-contacts').click();await p.getByText('新的朋友',{exact:true}).waitFor();await snap('contacts');
 await p.getByTestId('nav-tab-me').click();await p.locator('.wc-me-header').waitFor();await snap('profile');
 await p.getByText('外观',{exact:true}).click();await p.getByText('简体中文',{exact:true}).waitFor();await snap('settings');
 } catch(e){results.push({platform,width,theme,error:e.message}); console.error('FAIL',platform,width,theme,e.message)} finally {await f.context.close();}
}} finally {await browser.close();srv.server.close();fs.writeFileSync(O+'/visual-regression.json',JSON.stringify(results,null,2));}
assert.ok(!results.some(x=>x.error),'visual cases failed');})().catch(e=>{console.error(e.message);process.exitCode=1});
