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
test('publisher or final helper failure is propagated without successful install',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-'));const filename=path.join(dir,'update.exe');fs.writeFileSync(filename,bytes);
 try {await assert.rejects(trust.installVerified({filename,binding:trust.bindManifest(input()),policy,launch:async()=>{throw new Error('wrong publisher')}}),/wrong publisher/);}finally{fs.rmSync(dir,{recursive:true});}
});
test('Windows helper holds deny-write/delete handle through hash, publisher check and process exit (source contract)',()=>{
 const ps=fs.readFileSync(path.join(__dirname,'../src/lib/install-verified.ps1'),'utf8');
 for(const fragment of ['[IO.FileShare]::Read','OpenDirectory($directory)','0x02200000','GetFileInformationByHandleEx','ComputeHash($stream)','Get-AuthenticodeSignature -LiteralPath','$signature.Status -ne \'Valid\'','$pins -cnotcontains','$process.WaitForExit()']) assert(ps.includes(fragment));
 assert(ps.indexOf('ComputeHash($stream)')<ps.indexOf('[Diagnostics.Process]::Start'));
 const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');assert(!main.includes('verifyUpdateCodeSignature ='));assert(main.includes("autoInstallOnAppQuit = process.platform !== 'win32'"));
});
test('actual main updater handlers reject mismatched metadata and tampered completed download', async () => {
 const vm=require('vm');const source=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
 const verification=source.slice(source.indexOf('async function verifyUpdateSignature(info)'),source.indexOf('// ── 自动更新'));
 const wiring=source.slice(source.indexOf('function setupAutoUpdater()'),source.indexOf('// ── 系统托盘'));
 const handlers={},events=[];let downloads=0;
 const valid=input();
 const ctx={process:{platform:'win32',arch:'x64'},app:{getVersion:()=> '8.1.24'},crypto,updateTrust:trust,updatePolicy:{...policy,channel:'latest'},
  loadUpdatePublicKey:()=> publicKey,updateFeedBase:()=> 'https://fixture.invalid',channelYmlName:()=> 'latest.yml',
  fetchBuffer:async url=>url.endsWith('.sig')?valid.signature:valid.bytes,
  autoUpdater:{on:(n,fn)=>handlers[n]=fn,downloadUpdate:async()=>{downloads++}},
  log:{info(){},error(){}},mainWindow:{webContents:{send:(...args)=>events.push(args)}},
  trustedUpdate:null,downloadedInstaller:null,updateAttempt:0,installingUpdate:false};
 vm.runInNewContext(verification+wiring+';setupAutoUpdater()',ctx);
 await handlers['update-available']({...manifest,version:'999.0.0'});
 assert.equal(downloads,0);assert.equal(ctx.trustedUpdate,null);assert(events.some(e=>e[0]==='update:error'));
 await handlers['update-available'](manifest);assert.equal(downloads,1);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f12-wiring-'));const filename=path.join(dir,'update.exe');
 try {
  fs.writeFileSync(filename,bytes);await handlers['update-downloaded']({...manifest,downloadedFile:filename});assert.equal(ctx.downloadedInstaller,filename);
  fs.writeFileSync(filename,Buffer.alloc(bytes.length,7));await handlers['update-downloaded']({...manifest,downloadedFile:filename});assert.equal(ctx.downloadedInstaller,null);
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
