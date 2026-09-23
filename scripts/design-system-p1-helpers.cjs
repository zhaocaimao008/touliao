
const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '../desktop-electron/node_modules/playwright'),R=path.resolve(__dirname,'..'),O=path.resolve(process.env.UI_OUTPUT || 'artifacts/design-system-p1');
const {fixture}=require(R+'/scripts/windows-ui-smoke.cjs');
const {inspect}=require(R+'/scripts/windows-theme-smoke.cjs');
const build=path.resolve(process.env.UI_BUILD || path.join(R,'web/dist'));
const out=O+'/screenshots/targeted';fs.mkdirSync(out,{recursive:true});fs.mkdirSync(O+'/evidence',{recursive:true});
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{let f=path.resolve(build,'.'+new URL(req.url,'http://localhost').pathname);if(f===build)f+='/index.html';if(!f.startsWith(build+'/')||!fs.existsSync(f)||!fs.statSync(f).isFile())return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);});
const report={isolated:true,sourceHead:require('child_process').execSync('git rev-parse HEAD',{cwd:R,encoding:'utf8'}).trim(),nativeWindows:false,cases:[],scenarios:[],errors:[]};
async function shot(page,name){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);let data=await page.evaluate(()=>{
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.y<innerHeight&&getComputedStyle(e).visibility!=='hidden'};
 const props=['fontSize','fontWeight','lineHeight','fontFamily','color','backgroundColor','borderRadius','borderWidth','padding','gap','boxShadow','opacity','zIndex','transitionDuration','animationDuration'];
 const entry=e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {tag:e.tagName,class:e.className?.baseVal??e.className,text:(e.innerText||e.getAttribute('aria-label')||e.title||'').slice(0,100),role:e.getAttribute('role'),ariaLabel:e.getAttribute('aria-label'),tabIndex:e.tabIndex,testid:e.dataset.testid,box:{x:b.x,y:b.y,width:b.width,height:b.height},style:Object.fromEntries(props.map(p=>[p,s[p]]))}};
 const controls=[...document.querySelectorAll('button,a,[role="button"],[role="switch"],input,textarea,select,label.wc-tool-btn')].filter(visible).map(entry);
 const styles=[...document.querySelectorAll('.wc-msg-bubble,.wc-chat-item,.wc-crow,.wc-chat-header,.wc-input-area,.wc-switch,.gi-toggle,.wc-settings-toggle,.wc-avatar-face,.wc-chat-item-badge,.wc-ctx-menu,.wc-toast,.wc-confirm-box,.auth-field-input-wrap')].filter(visible).map(entry);
 return {viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth,controls,styles,focus:entry(document.activeElement),theme:document.body.className,panels:{emoji:!!document.querySelector('.wc-emoji-picker'),more:!!document.querySelector('.wc-more-panel'),voice:!!document.querySelector('.wc-voice-btn')},css:{primary:getComputedStyle(document.body).getPropertyValue('--tl-primary'),danger:getComputedStyle(document.body).getPropertyValue('--tl-readable-danger')}};
 });
 try{const c=await inspect(page);data.contrastCandidates=c.texts.filter(t=>t.critical&&!t.disabled&&!t.avatar&&t.contrast!==null&&t.contrast<4.5);data.fieldContrastCandidates=c.fields.filter(t=>t.contrast!==null&&t.contrast<4.5);}catch(e){data.contrastError=String(e)}
 const cdp=await page.context().newCDPSession(page);const ax=await cdp.send('Accessibility.getFullAXTree');data.axControls=ax.nodes.filter(n=>!n.ignored&&['button','switch','textbox','checkbox','link','tab','dialog'].includes(n.role?.value)).map(n=>({role:n.role.value,name:n.name?.value,properties:n.properties}));await cdp.detach();
 await page.screenshot({path:out+'/'+name+'.png',animations:'disabled'});report.cases.push({name,...data});console.log('CAPTURE',name);
}
module.exports={server,shot,report};
