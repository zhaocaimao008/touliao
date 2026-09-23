const assert=require('node:assert/strict'),fs=require('fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const {fixture}=require('./windows-ui-smoke.cjs');
const {server,shot,report}=require('./design-system-p1-helpers.cjs');
const O=require('path').resolve(process.env.UI_OUTPUT || 'artifacts/design-system-p1');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(){await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
try {for(const[platform,width,height]of[['web',390,844],['win32',1200,800]])for(const theme of ['light','dark']){
 const f=await fixture(browser,base,{platform,width,height,skin:'touliao',theme}),{page,context}=f;page.setDefaultTimeout(12000);const prefix=platform+'-'+theme;
 try{
  let calls=[],block=false;
  const item=(id,type='file')=>({id,type,fileName:id,fileUrl:'/uploads/edge.bin',fileSize:777,senderName:'测试',createdAt:1789820000});
  await context.route('**/api/messages/conversation/ui-0/files*',async r=>{
   const p=new URL(r.request().url()).searchParams,type=p.get('type'),offset=+p.get('offset');calls.push({type,offset});
   if(type==='image'){await delay(700);return r.fulfill({json:{total:1,items:[item('STALE IMAGE','image')]}}).catch(()=>{});}
   if(type==='video')return r.fulfill({json:{total:1,items:[item('CURRENT VIDEO','video')]}});
   if(type==='file')return r.fulfill({json:{total:0,items:[]}});
   if(block)return r.fulfill({status:410,json:{error:'isolated expired file list'}});
   return r.fulfill({json:{total:45,items:Array.from({length:offset?15:30},(_,i)=>item('文件-'+(offset+i)))}});
  });
  await page.getByTestId('conv-item-ui-0').click();await page.getByTestId('chat-group-info-btn').click();
  const switches=page.locator('.wc-settings-panel [role="switch"]');const before=await switches.first().getAttribute('aria-checked');await switches.first().focus();await page.keyboard.press('Space');await page.waitForFunction(v=>document.querySelector('.wc-settings-panel [role="switch"]').getAttribute('aria-checked')!==v,before);
  await page.getByText('聊天文件',{exact:true}).click();await page.locator('.chatfiles-item').first().waitFor();assert.equal(await page.locator('.chatfiles-item').count(),30);
  await page.locator('.chatfiles-list').evaluate(e=>{e.scrollTop=e.scrollHeight});await page.waitForFunction(()=>document.querySelectorAll('.chatfiles-item').length===45);assert.deepEqual(calls.filter(x=>x.type==='all').map(x=>x.offset),[0,30]);
  await page.getByRole('button',{name:'图片',exact:true}).click();await delay(70);await page.getByRole('button',{name:'视频',exact:true}).click();await page.getByText('CURRENT VIDEO',{exact:true}).waitFor();await delay(1000);assert.equal(await page.getByText('STALE IMAGE',{exact:true}).count(),0);
  await page.getByRole('button',{name:'文件',exact:true}).click();await page.locator('.chatfiles-panel .wc-state--empty').waitFor();await shot(page,prefix+'-files-empty');
  block=true;await page.getByRole('button',{name:'全部',exact:true}).click();await page.locator('.chatfiles-panel .wc-state--error').waitFor();await shot(page,prefix+'-files-expired');block=false;await page.locator('.wc-state-retry').click();await page.locator('.chatfiles-item').first().waitFor();
  report.scenarios.push({prefix,pagination:'PASS',staleResponse:'PASS',empty:'PASS',expiredRetry:'PASS',switchKeyboard:'PASS'});
  await context.close();
  const auth=await fixture(browser,base,{platform,width,height,theme,skin:'touliao',authenticated:false});const p=auth.page;await p.locator('a[href$="register"]').click();
  await p.getByTestId('register-username-input').fill('A');await p.getByTestId('register-phone-input').fill('13800000000');await p.getByTestId('register-password-input').fill('password123');await p.getByTestId('register-invite-input').fill('123456');await p.getByTestId('register-submit-btn').click();
  assert.equal(await p.getByTestId('register-username-input').getAttribute('aria-invalid'),'true');const desc=await p.getByTestId('register-username-input').getAttribute('aria-describedby');assert.ok(await p.locator('#'+desc).innerText());assert.ok((await p.getByTestId('register-submit-btn').boundingBox()).height >= (width<768?48:40));await shot(p,prefix+'-field-error');await auth.context.close();
 }catch(error){report.errors.push({prefix,error:error.stack});await context.close();}
 report.errors.push(...f.errors.map(pageError=>({prefix,pageError})));
 }
 for(const theme of ['light','dark']){
  const {page,context,errors}=await fixture(browser,base,{platform:'web',width:320,height:568,skin:'touliao',theme});page.setDefaultTimeout(10000);
  try{
   let downloadFails=true;
   await page.evaluate(()=>{window.showSaveFilePicker=undefined});
   await context.route('**/api/messages/ui-0*',r=>r.fulfill({json:[{id:'unknown',conversation_id:'ui-0',sender_id:'peer-0',type:'file',content:'无扩展名文件',file_url:'/uploads/edge-no-extension',file_size:0,created_at:1789820000}]}));
   await context.route('**/uploads/edge-no-extension*',async r=>{await delay(1000);return downloadFails?r.fulfill({status:410,body:'expired'}):r.fulfill({contentType:'application/octet-stream',body:Buffer.from('isolated content')});});
   await page.getByTestId('conv-item-ui-0').click();await page.getByTestId('msg-bubble-unknown').locator('a').click();await page.getByTestId('file-preview-download').click();await shot(page,'web-'+theme+'-download-progress');await page.getByText('下载失败',{exact:true}).waitFor();await shot(page,'web-'+theme+'-download-error');
   downloadFails=false;await page.getByRole('button',{name:'重试',exact:true}).click();await page.getByText('已保存 ✓',{exact:true}).waitFor();await shot(page,'web-'+theme+'-download-retried');report.scenarios.push({theme,downloadRetry:'PASS',noExtension:'PASS'});
  }catch(error){report.errors.push({prefix:'download-'+theme,error:error.stack});}report.errors.push(...errors.map(pageError=>({pageError})));await context.close();
 }
}finally {await browser.close();server.close();report.passed=report.errors.length===0;fs.writeFileSync(O+'/evidence/edge-review.json',JSON.stringify(report,null,2));}
assert.deepEqual(report.errors,[]);}
run().catch(e=>{console.error(e);server.close();process.exitCode=1});
