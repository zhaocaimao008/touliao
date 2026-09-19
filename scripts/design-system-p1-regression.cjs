const assert=require('node:assert/strict'),fs=require('fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright');
const {fixture}=require('./windows-ui-smoke.cjs');
const {server,shot,report}=require('./design-system-p1-helpers.cjs');
const O=require('path').resolve(process.env.UI_OUTPUT || 'artifacts/design-system-p1');
async function trapped(page, selector, count=8) {
  for(const key of ['Tab','Shift+Tab'])for(let i=0;i<count;i++){
    await page.keyboard.press(key);
    assert.ok(await page.evaluate(s=>!!document.activeElement.closest(s),selector),key+' trapped in '+selector);
  }
}
async function run(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
 try{
 for(const [platform,width,height] of [['web',390,844],['win32',1200,800]])for(const theme of ['light','dark']){
  const f=await fixture(browser,base,{platform,width,height,skin:'touliao',theme}),{page,context}=f,prefix=platform+'-'+theme;page.setDefaultTimeout(8000);
  try {
   await page.getByTestId('conv-item-ui-0').click();await page.locator('.wc-msg-bubble').first().waitFor();
   const input=page.getByTestId('chat-msg-input');await input.fill('中文草稿');
   for(let i=0;i<3;i++){
    await page.getByTestId('chat-emoji-panel-btn').click();await page.locator('.wc-emoji-picker').waitFor();
    await page.locator('.wc-tool-btn[aria-label="语音输入"]').click();await page.locator('.wc-voice-btn').waitFor();
    assert.equal(await page.locator('.wc-emoji-picker,.wc-more-panel').count(),0);
    await page.getByTestId('chat-more-panel-btn').click();await page.locator('.wc-more-panel').waitFor();
    assert.equal(await page.locator('.wc-voice-btn,.wc-emoji-picker').count(),0);
    await page.getByTestId('chat-more-panel-btn').click();await input.waitFor();assert.equal(await input.inputValue(),'中文草稿');
   }
   await shot(page,prefix+'-composer');await input.fill('');assert.equal(await page.getByTestId('chat-send-btn').isDisabled(),true);
   await page.getByTestId('chat-emoji-panel-btn').click();await shot(page,prefix+'-emoji');
   await page.getByTestId('chat-more-panel-btn').click();await shot(page,prefix+'-more');await page.keyboard.press('Escape');
   await page.locator('.wc-msg-bubble').first().click({button:'right'});await page.getByTestId('ctx-copy').waitFor();
   await page.waitForFunction(()=>document.activeElement?.dataset.testid==='ctx-copy');
   await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>document.activeElement.dataset.testid),'ctx-reply');
   await page.keyboard.press('End');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.testid),'ctx-copy');
   await shot(page,prefix+'-menu');await page.keyboard.press('Escape');assert.equal(await page.locator('[role="menu"]').count(),0);
   await page.getByTestId('chat-group-info-btn').click();await page.locator('.wc-settings-panel').waitFor();
   const panel=await page.locator('.wc-settings-panel').boundingBox();if(width<768){assert.ok(panel.width>=width-1);assert.ok((await page.locator('.wc-chat-header').boundingBox()).width>=width-1);}
   const switches=page.locator('.wc-settings-panel [role="switch"]');assert.equal(await switches.count(),2);
   for(let i=0;i<2;i++){const bb=await switches.nth(i).boundingBox();assert.ok(bb.width>=44&&bb.height>=44);}
   await shot(page,prefix+'-private-settings');const snap=report.cases.at(-1);assert.ok(snap.axControls.filter(x=>x.role==='switch').every(x=>x.name));
   const contrast=await page.locator('.wc-settings-clear-btn').evaluate(el=>{
    const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');
    const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3)};
    const luminance=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    const css=getComputedStyle(el),f=luminance(rgb(css.color)),b=luminance(rgb(css.backgroundColor));return {ratio:(Math.max(f,b)+.05)/(Math.min(f,b)+.05),foreground:css.color,background:css.backgroundColor};
   });assert.ok(contrast.ratio>=4.5,JSON.stringify(contrast));report.scenarios.push({prefix,dangerContrast:contrast});
   await page.locator('.wc-settings-clear-btn').click();await page.getByTestId('confirm-cancel').waitFor();
   await page.waitForFunction(()=>document.activeElement?.dataset.testid==='confirm-cancel');await trapped(page,'.tl-dialog');
   await shot(page,prefix+'-dialog');await page.keyboard.press('Escape');assert.equal(await page.locator('.tl-dialog').count(),0);
   assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('wc-settings-clear-btn')),true);
   let requests=0,fail=true;
   await context.route('**/api/messages/conversation/ui-0/files*',r=>{requests++;return fail?r.fulfill({status:500,json:{error:'isolated test'}}):r.fulfill({json:{total:1,items:[{id:'file',type:'file',fileName:'中文文件名.unknown',fileSize:10737418240,fileUrl:'/uploads/example.unknown',senderName:'测试',createdAt:1789820000}]}})});
   await page.getByText('聊天文件',{exact:true}).click();await page.locator('.chatfiles-panel .wc-state--error').waitFor();const settled=requests;assert.ok(settled<=4,'bounded existing transport retries');await page.waitForTimeout(6000);assert.equal(requests,settled,'no observer retry after displayed failure');
   await shot(page,prefix+'-files-error');fail=false;await page.locator('.chatfiles-panel .wc-state-retry').click();await page.locator('.chatfiles-item').waitFor();assert.equal(requests,settled+1);
   assert.ok(!(await page.locator('.chatfiles-panel').innerText()).includes('chatFiles.'));await shot(page,prefix+'-files');await trapped(page,'.chatfiles-overlay-root');
   await page.keyboard.press('Escape');assert.equal(await page.locator('.chatfiles-overlay-root').count(),0);
   report.scenarios.push({prefix,p1Controls:'PASS',requests});
  }catch(error){report.errors.push({prefix,error:error.stack});await page.screenshot({path:O+'/screenshots/targeted/'+prefix+'-failure.png'});}
  report.errors.push(...f.errors.map(pageError=>({prefix,pageError})));await context.close();
 }
 for(const theme of ['light','dark']){
  const f=await fixture(browser,base,{platform:'web',width:320,height:568,theme,skin:'touliao'}),{page,context}=f;page.setDefaultTimeout(8000);
  try {
   const filename='中文文件名'.repeat(40)+'.unknown';await context.route('**/api/messages/ui-0*',r=>r.fulfill({json:[{id:'stress-file',conversation_id:'ui-0',sender_id:'peer-0',type:'file',content:filename,file_url:'/uploads/stress.unknown',file_size:10737418240,created_at:1789820000}]}));
   await page.getByTestId('conv-item-ui-0').click();await page.getByTestId('msg-bubble-stress-file').locator('a').click();await page.getByTestId('file-preview').waitFor();
   await trapped(page,'[data-testid="file-preview"]');await page.locator('.tl-file-details').evaluate(e=>{e.scrollTop=e.scrollHeight});
   const geometry=await page.locator('.tl-file-details-description').evaluate(e=>{const a=e.getBoundingClientRect(),p=e.parentElement.getBoundingClientRect();return {visible:a.top>=p.top&&a.bottom<=p.bottom,scroll:e.parentElement.scrollHeight,client:e.parentElement.clientHeight}});
   assert.ok(geometry.visible,'description reachable by scroll');assert.ok((await page.getByTestId('file-preview-download').boundingBox()).y<568);
   await shot(page,'web-320-568-'+theme+'-file-detail');report.scenarios.push({theme,filenameLength:filename.length,geometry});
   await page.keyboard.press('Escape');assert.equal(await page.getByTestId('file-preview').count(),0);
  }catch(error){report.errors.push({prefix:'file-'+theme,error:error.stack});}
  report.errors.push(...f.errors.map(pageError=>({pageError})));await context.close();
 }
 }finally {await browser.close();server.close();report.passed=report.errors.length===0;fs.writeFileSync(O+'/evidence/p1-review.json',JSON.stringify(report,null,2));}
 assert.deepEqual(report.errors,[]);
}
run().catch(e=>{console.error(e);server.close();process.exitCode=1});
