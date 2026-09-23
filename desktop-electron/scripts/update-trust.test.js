'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs=require('fs'), os=require('os'), path=require('path'), crypto=require('crypto');
const yaml=require('js-yaml');
const trust=require('../src/lib/updateTrust');
const { publicKey, privateKey }=crypto.generateKeyPairSync('ed25519');
const pub=publicKey.export({type:'spki',format:'pem'});
const bytes=Buffer.from('synthetic installer, never executable');
const manifest={version:'9.0.0',files:[{url:'touliao-9.0.0-setup.exe',sha512:crypto.createHash('sha512').update(bytes).digest('base64'),size:bytes.length}],touliao:{platform:'win32',arch:'x64',channel:'latest'}};
function input(info=manifest, signed=manifest) { const data=Buffer.from(yaml.dump(signed)); return {bytes:data,signature:crypto.sign(null,data,privateKey),publicKey:pub,info,currentVersion:'8.1.24',platform:'win32',arch:'x64',channel:'latest'}; }
const policy={publisherThumbprints:['A'.repeat(40)]};
test('valid signature binds version, platform, channel and exact installer',()=>{ assert.equal(trust.bindManifest(input()).version,'9.0.0'); });
for(const change of [{version:'999.0.0'},{files:[{...manifest.files[0],sha512:Buffer.alloc(64).toString('base64')}]},{packages:{x64:{path:'remote.pkg'}}}]) {
 test('different updater response is refused '+Object.keys(change)[0],()=>assert.throws(()=>trust.bindManifest(input({...manifest,...change}))));
}
test('missing signature, wrong signing key, tampered bytes are refused',()=>{
 for(const args of [{signature:null},{signature:crypto.sign(null,input().bytes,crypto.generateKeyPairSync('ed25519').privateKey)},{bytes:Buffer.from('evil')}]) assert.throws(()=>trust.bindManifest({...input(),...args}));
});
for(const touliao of [{...manifest.touliao,platform:'linux'},{...manifest.touliao,channel:'beta'},{...manifest.touliao,arch:'arm64'}]) {
 test('signed wrong release context is refused '+JSON.stringify(touliao),()=>assert.throws(()=>trust.bindManifest(input({...manifest,touliao},{...manifest,touliao}))));
}
test('replay and downgrade are refused',()=>assert.throws(()=>trust.bindManifest({...input(),currentVersion:'9.0.0'})));
test('untrusted response public key does not become trust anchor',()=>{
 const attacker=crypto.generateKeyPairSync('ed25519'); const candidate={...manifest,publicKey:attacker.publicKey.export({type:'spki',format:'pem'})};const i=input(candidate,candidate);i.signature=crypto.sign(null,i.bytes,attacker.privateKey);assert.throws(()=>trust.bindManifest(i));
});
test('missing publisher policy blocks even a valid file',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-'));const filename=path.join(dir,'update.exe');fs.writeFileSync(filename,bytes);let launches=0;
 try {await assert.rejects(trust.installVerified({filename,binding:trust.bindManifest(input()),policy:{publisherThumbprints:[]},launch:()=>{launches++}}));assert.equal(launches,0);}finally{fs.rmSync(dir,{recursive:true});}
});
test('valid download allowed; tamper or post-download cache replacement blocks installation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-'));const filename=path.join(dir,'update.exe');const binding=trust.bindManifest(input());let launches=0;
 try {
 fs.writeFileSync(filename,bytes);trust.verifyFile(filename,binding);
 await trust.installVerified({filename,binding,policy,launch:async()=>{launches++}});assert.equal(launches,1);
 fs.writeFileSync(filename,Buffer.alloc(bytes.length,9));
 await assert.rejects(trust.installVerified({filename,binding,policy,launch:async()=>{launches++}}));assert.equal(launches,1);
 fs.unlinkSync(filename);fs.symlinkSync(path.join(dir,'elsewhere'),filename);assert.throws(()=>trust.verifyFile(filename,binding));
 } finally {fs.rmSync(dir,{recursive:true});}
});
test('injected launcher failure propagates (not an Authenticode test)',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-'));const filename=path.join(dir,'update.exe');fs.writeFileSync(filename,bytes);
 try {await assert.rejects(trust.installVerified({filename,binding:trust.bindManifest(input()),policy,launch:async()=>{throw new Error('wrong publisher')}}),/wrong publisher/);}finally{fs.rmSync(dir,{recursive:true});}
});
test('automatic install on app quit is disabled on every platform', () => {
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 const statement=source.match(/^autoUpdater\.autoInstallOnAppQuit = .+;$/m);
 assert(statement, 'missing actual updater setting');
 for(const platform of ['win32','darwin','linux']) {
   const ctx={autoUpdater:{autoInstallOnAppQuit:true}, process:{platform}, PROFILE:1};
   require('vm').runInNewContext(statement[0],ctx); assert.equal(ctx.autoUpdater.autoInstallOnAppQuit,false);
 }
});
function mainSlice(start, end) {
 const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
 assert(a>=0 && b>a, 'main entrypoint markers missing: '+start);
 return source.slice(a,b);
}
test('supplementary helper source contract binds locked handle, digest and publisher before launch and holds locks until exit', () => {
 // IPC tests mock spawn; this checks helper source only, not Windows signature or lock behavior.
 const source=fs.readFileSync(path.join(__dirname,'../src/lib/install-verified.ps1'),'utf8')
   .replace(/^\s*#.*$/gm,'').replace(/\/\/[^\n]*/g,'');
 const ordered=(scope,patterns)=>{
   let cursor=0;
   for(const pattern of patterns) {
     const match=pattern.exec(scope.slice(cursor));
     assert(match,'missing or out-of-order helper contract: '+pattern);
     cursor+=match.index+match[0].length;
   }
 };
 const open=source.match(/public static SafeFileHandle OpenInstaller\(string path\) \{([\s\S]*?)public static SafeFileHandle OpenDirectory/);
 assert(open,'OpenInstaller implementation missing');
 ordered(open[1],[
   /var handle = CreateFile\(path, 0x80000000, 1, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero\);/,
   /if \(handle.IsInvalid\) \{ handle.Dispose\(\); throw new Win32Exception\(Marshal.GetLastWin32Error\(\)\); \}/,
   /if \(!GetFileInformationByHandleEx\(handle, 9, out info, 8\) \|\| \(info.Attributes & 0x410\) != 0\) \{\s*handle.Dispose\(\); throw new InvalidOperationException\("Untrusted update file"\);\s*\}/,
   /return handle;/,
 ]);
 const runtime=source.slice(source.indexOf('$fullPath ='));
 ordered(runtime,[
   /foreach \(\$directory in \$parents\) \{ \$directoryLocks.Add\(\[TouliaoUpdatePathLock\]::OpenDirectory\(\$directory\)\) \}/,
   /\$pins = \$PublisherPins.Split\(','\)/,
   /\$handle = \[TouliaoUpdatePathLock\]::OpenInstaller\(\$fullPath\)/,
   /\$stream = New-Object IO.FileStream\(\$handle, \[IO.FileAccess\]::Read\)/,
   /\$actual = \[BitConverter\]::ToString\(\$hash.ComputeHash\(\$stream\)\).Replace\('-', ''\).ToLowerInvariant\(\)/,
   /if \(\$actual -cne \$ExpectedSha512\) \{ throw 'Installer digest mismatch' \}/,
   /\$signature = Get-AuthenticodeSignature -LiteralPath \$fullPath/,
   /if \(\$signature.Status -ne 'Valid' -or \$null -eq \$signature.SignerCertificate -or \$pins -cnotcontains \$signature.SignerCertificate.Thumbprint\) \{\s*throw 'Untrusted publisher or invalid Authenticode signature'\s*\}/,
   /\$start.FileName = \$fullPath/,
   /\$process = \[Diagnostics.Process\]::Start\(\$start\)/,
   /\$process.WaitForExit\(\)/,
   /exit \$process.ExitCode/,
   /finally \{\s*if \(\$null -ne \$stream\) \{ \$stream.Dispose\(\) \}\s*foreach \(\$directoryLock in \$directoryLocks\) \{ \$directoryLock.Dispose\(\) \}\s*\}/,
 ]);
 assert.equal((runtime.match(/\[Diagnostics.Process\]::Start\(/g)||[]).length,1,'single verified launch');
 assert.equal((runtime.match(/\$stream.Dispose\(\)/g)||[]).length,1,'file lock released only in final cleanup');
 assert.equal((runtime.match(/\$directoryLock.Dispose\(\)/g)||[]).length,1,'directory locks released only in final cleanup');
});
test('actual main updater handlers reject mismatched metadata and tampered completed download', async () => {
 const vm=require('vm');const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 const verification=mainSlice('async function verifyUpdateSignature(info)', '// ── 自动更新');
 const wiring=mainSlice('function setupAutoUpdater()', '// ── 系统托盘');
 const handlers={},events=[];let downloads=0;
 const valid=input();
 const ctx={process:{platform:'win32',arch:'x64'},app:{getVersion:()=> '8.1.24'},crypto,updateTrust:trust,updatePolicy:{...policy,channel:'latest'},
  loadUpdatePublicKey:()=> publicKey,updateFeedBase:()=> 'https://fixture.invalid',channelYmlName:()=> 'latest.yml',
  fetchBuffer:async url=>url.endsWith('.sig')?valid.signature:valid.bytes,
  autoUpdater:{on:(n,fn)=>handlers[n]=fn,downloadUpdate:async()=>{downloads++}},
  log:{info(){},error(){}},mainWindow:{webContents:{send:(...args)=>events.push(args)}},
  trustedUpdate:null,downloadedInstaller:null,updateAttempt:0,installingUpdate:false,updateInstallRequested:false,updateReady:false};
 vm.runInNewContext(verification+wiring+';setupAutoUpdater()',ctx);
 await handlers['update-available']({...manifest,version:'999.0.0'});
 assert.equal(downloads,0);assert.equal(ctx.trustedUpdate,null);assert(events.some(e=>e[0]==='update:error'));
 await handlers['update-available'](manifest);assert.equal(downloads,1);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-wiring-'));const filename=path.join(dir,'update.exe');
 try {
  fs.writeFileSync(filename,bytes);await handlers['update-downloaded']({...manifest,downloadedFile:filename});assert.equal(ctx.downloadedInstaller,filename);assert.equal(ctx.updateReady,true);
  ctx.updateReady=false;
  fs.writeFileSync(filename,Buffer.alloc(bytes.length,7));await handlers['update-downloaded']({...manifest,downloadedFile:filename});assert.equal(ctx.downloadedInstaller,null);assert.equal(ctx.updateReady,false);
  ctx.fetchBuffer=async()=>null;await handlers['update-available'](manifest);assert.equal(ctx.trustedUpdate,null);assert.equal(downloads,1);
 } finally {fs.rmSync(dir,{recursive:true});}
});
test('release signer signs platform/channel context together with the installer digest',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-sign-'));
 try {
  const key=path.join(dir,'synthetic-private.pem');fs.writeFileSync(key,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  const unsigned={...manifest};delete unsigned.touliao;fs.writeFileSync(path.join(dir,'latest.yml'),yaml.dump(unsigned));
  require('./sign-update').signAll(dir,key,['latest.yml']);
  const signed=fs.readFileSync(path.join(dir,'latest.yml'));const info=yaml.load(signed.toString());
  assert.equal(trust.bindManifest({...input(info),bytes:signed,signature:fs.readFileSync(path.join(dir,'latest.yml.sig'))}).version,'9.0.0');
 }finally{fs.rmSync(dir,{recursive:true});}
});
test('desktop log hook redacts media tickets and Bearer headers before persistence',()=>{
 const {redact}=require('../src/lib/redactTelemetry');
 const input=['download failed /uploads/a?token=synthetic-secret',{headers:{Authorization:'Bearer synthetic-secret'}}];
 assert(!JSON.stringify(redact(input)).includes('synthetic-secret'));
});
test('test runtime matches the repository-locked updater and YAML parser versions',()=>{
 const lock=require('../package-lock.json');
 for(const name of ['electron-updater','js-yaml']) assert.equal(require(name+'/package.json').version,lock.packages['node_modules/'+name].version);
});

function installHarness(platform='win32') {
 const { EventEmitter }=require('events');
 const handlers={}, events=[], children=[], spawns=[]; let quits=0, updaterInstalls=0;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-ipc-')), filename=path.join(dir,'update.exe');
 fs.writeFileSync(filename,bytes);
 const ctx={process:{platform,resourcesPath:'C:/fixture/resources',env:{SystemRoot:'C:/Windows'}},path, updateTrust:trust,
   updatePolicy:policy, trustedUpdate:trust.bindManifest(input()), downloadedInstaller:filename, PROFILE:1, installingUpdate:false,
   updateReady:true, updateInstallRequested:false, autoUpdater:{quitAndInstall:()=>updaterInstalls++},
   strictUpdateMode:()=>{ try { trust.publishers(ctx.updatePolicy); return true; } catch { return false; } },
   isTrustedSender:e=>e.trusted, isQuitting:false, app:{quit:()=>quits++},
   mainWindow:{webContents:{send:(...args)=>events.push(args)}},ipcMain:{handle:(name,handler)=>handlers[name]=handler},
   require:name=>{ assert.equal(name,'child_process'); return {spawn:(...args)=>{
     spawns.push(args); const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr={resume(){}};child.unref=()=>{};
     children.push(child);return child;
   }}; }};
 require('vm').runInNewContext(mainSlice("  ipcMain.handle('update:install'",'  // 更新：用户手动'),ctx);
 assert.equal(typeof handlers['update:install'],'function');
 return { ctx, events, spawns, children, filename, quits:()=>quits, updaterInstalls:()=>updaterInstalls, install:()=>handlers['update:install']({trusted:true}),
   untrusted:()=>handlers['update:install']({trusted:false}), close:()=>fs.rmSync(dir,{recursive:true,force:true}) };
}
test('actual install IPC invokes pinned helper with process execution policy and waits for complete STARTED line', async()=>{
 const h=installHarness();try {
   const pending=h.install(); assert.equal(h.spawns.length,1); assert.equal(h.quits(),0);
   await h.install();assert.equal(h.spawns.length,1); // concurrent clicks cannot start two installers
   const [shell,args,options]=h.spawns[0];assert(shell.endsWith('powershell.exe'));
   assert.equal(args[args.indexOf('-ExecutionPolicy')+1],'Bypass');
   assert.equal(args[args.indexOf('-Installer')+1],h.filename);
   assert.equal(args[args.indexOf('-ExpectedSha512')+1],Buffer.from(manifest.files[0].sha512,'base64').toString('hex'));
   assert.equal(args[args.indexOf('-PublisherPins')+1],policy.publisherThumbprints.join(','));assert.equal(options.windowsHide,true);
   h.children[0].stdout.emit('data',Buffer.from('START'));assert.equal(h.quits(),0);
   h.children[0].stdout.emit('data',Buffer.from('ED\r\n'));await pending;
   assert.equal(h.quits(),1);assert.equal(h.ctx.isQuitting,true);assert.equal(h.events.length,0);
 }finally{h.close();}
});
test('install IPC blocks missing state after restart, tampering, untrusted IPC and non-Windows platforms',async()=>{
 for(const scenario of ['restart','tamper','sender','unpinned-tamper','darwin','linux']) {
   const h=installHarness(['darwin','linux'].includes(scenario)?scenario:'win32');try {
     if(scenario==='restart') { h.ctx.trustedUpdate=null;h.ctx.downloadedInstaller=null;h.ctx.updateReady=false; }
     if(scenario.endsWith('tamper')) fs.writeFileSync(h.filename,Buffer.alloc(bytes.length,2));
     if(scenario==='unpinned-tamper') h.ctx.updatePolicy={publisherThumbprints:[]};
     const run=scenario==='sender'?h.untrusted():h.install();
     if(scenario==='restart') await assert.rejects(run,/下载完成/);
     else if(scenario==='unpinned-tamper') await assert.rejects(run,/摘要不一致/);
     else await run;
     assert.equal(h.spawns.length,0,scenario);assert.equal(h.quits(),0,scenario);assert.equal(h.updaterInstalls(),0,scenario);
     assert.equal(h.ctx.isQuitting,false,scenario);
     if(['tamper','darwin','linux'].includes(scenario)) assert(h.events.some(e=>e[0]==='update:error'),scenario);
   }finally{h.close();}
 }
});
test('without publisher pins the bound installer is handed to electron-updater, never the pinned helper',async()=>{
 const h=installHarness();try {
   h.ctx.updatePolicy={publisherThumbprints:[]};
   await h.install();await h.install();
   assert.equal(h.updaterInstalls(),1);assert.equal(h.spawns.length,0);assert.equal(h.ctx.isQuitting,true);
 }finally{h.close();}
});
test('helper spawn error, crash, nonzero exit and misleading stdout never report installation success',async()=>{
 for(const scenario of ['error','exit','crash','bad-stdout']) {
   const h=installHarness();try {
     const pending=h.install();const child=h.children[0];
     if(scenario==='error') child.emit('error',new Error('ENOENT'));
     else { if(scenario==='bad-stdout') child.stdout.emit('data',Buffer.from('NOT_STARTED\n')); child.emit('exit',scenario==='crash'?null:1,scenario==='crash'?'SIGKILL':null); }
     await pending;assert.equal(h.quits(),0);assert.equal(h.ctx.isQuitting,false);
     assert(h.events.some(e=>e[0]==='update:error'));assert.equal(h.ctx.installingUpdate,false);
   }finally{h.close();}
 }
});
test('real updater YAML parser preserves the signed context used by binding',()=>{
 const { parseUpdateInfo }=require('electron-updater/out/providers/Provider');
 const i=input();const parsed=parseUpdateInfo(i.bytes.toString(),'latest.yml','https://fixture.invalid/latest.yml');
 assert.deepEqual(parsed.touliao,manifest.touliao);assert.equal(trust.bindManifest({...i,info:parsed}).version,'9.0.0');
});
test('actual fetchBuffer rejects disconnected, aborted and timeout transfers, and permits retry',async()=>{
 const {EventEmitter}=require('events');
 for(const scenario of ['error','aborted','timeout','success']) {
   const req=new EventEmitter(),res=new EventEmitter();res.statusCode=200;
   req.destroy=error=>req.emit('error',error || new Error('destroyed'));
   const ctx={Buffer,https:{get:(_url,_options,callback)=>{queueMicrotask(()=>{
      callback(res);
      if(scenario==='error') res.emit('error',new Error('offline'));
      if(scenario==='aborted') res.emit('aborted');
      if(scenario==='timeout') req.emit('timeout');
      if(scenario==='success') {res.emit('data',Buffer.from('retry-ok'));res.emit('end');}
   });return req;}}};
   require('vm').runInNewContext(mainSlice('function fetchBuffer(', '// 验证更新元数据签名'),ctx);
   if(scenario==='success') assert.equal((await ctx.fetchBuffer('https://fixture.invalid')).toString(),'retry-ok');
   else await assert.rejects(ctx.fetchBuffer('https://fixture.invalid'));
 }
});
test('locked updater default interactive install uses the same updated and force-run arguments',()=>{
 const {BaseUpdater}=require('electron-updater/out/BaseUpdater');
 const {NsisUpdater}=require('electron-updater/out/NsisUpdater');
 let options;
 BaseUpdater.prototype.quitAndInstall.call({autoRunAppAfterInstall:true,_logger:{info(){}},
   install:(isSilent,isForceRunAfter)=>{options={isSilent,isForceRunAfter};return false;}});
 assert.deepEqual(options,{isSilent:false,isForceRunAfter:true});
 let args;
 NsisUpdater.prototype.doInstall.call({installerPath:'C:/fixture/update.exe',downloadedUpdateHelper:null,
   _logger:{info(){}},spawnLog:(_exe,actual)=>{args=actual;return Promise.resolve();}},options);
 assert.deepEqual(args,['--updated','--force-run']);
});
test('actual available handler blocks non-Windows before fetching and never downloads without a signed binding',async()=>{
 for(const platform of ['darwin','linux','win32']) {
   const handlers={},events=[];let downloads=0,fetches=0;
   const ctx={process:{platform}, updateTrust:trust,updatePolicy:{publisherThumbprints:[]},installingUpdate:false,
     updateAttempt:0,trustedUpdate:null,downloadedInstaller:null,updateInstallRequested:false,updateReady:false,
     verifyUpdateSignature:async()=>{fetches++;return 'ok';},log:{info(){},error(){}},
     mainWindow:{webContents:{send:(...args)=>events.push(args)}},
     autoUpdater:{on:(n,h)=>handlers[n]=h,downloadUpdate:async()=>downloads++}};
   require('vm').runInNewContext(mainSlice('function setupAutoUpdater()', '// ── 系统托盘')+';setupAutoUpdater();',ctx);
   await handlers['update-available'](manifest);assert.equal(downloads,0);assert.equal(fetches,platform==='win32'?1:0);
   assert(events.some(e=>e[0]==='update:error' && e[1].includes(platform==='win32'?'校验失败':'当前平台')));
 }
});
