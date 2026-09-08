'use strict';
const { preflight } = require('../../desktop-electron/scripts/preflight-signing');
const { generateKeyPairSync } = require('crypto');
const fs = require('fs');const os = require('os');const path = require('path');
let dir,privatePath,publicPath;
beforeAll(()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'tl-signing-test-'));
  privatePath=path.join(dir,'test-private.pem');publicPath=path.join(dir,'test-public.pem');
  const keys=generateKeyPairSync('ed25519');
  fs.writeFileSync(privatePath,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  fs.writeFileSync(publicPath,keys.publicKey.export({type:'spki',format:'pem'}));
});
afterAll(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('missing signing material fails before builder starts',()=>expect(()=>preflight({},publicPath)).toThrow('UPDATE_PRIVATE_KEY'));
test('missing private file fails clearly',()=>expect(()=>preflight({UPDATE_PRIVATE_KEY:path.join(dir,'absent')},publicPath)).toThrow('不可读取'));
test('malformed private key fails without leaking contents',()=>expect(()=>preflight({UPDATE_PRIVATE_KEY:publicPath},publicPath)).toThrow('格式无效'));
test('matching temporary test keypair passes',()=>expect(preflight({UPDATE_PRIVATE_KEY:privatePath},publicPath)).toBe(true));
test('wrong public key blocks release',()=>{
  const other=path.join(dir,'other.pem');fs.writeFileSync(other,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}));
  expect(()=>preflight({UPDATE_PRIVATE_KEY:privatePath},other)).toThrow('不匹配');
});
test('non-Ed25519 private key rejected',()=>{
  const other=path.join(dir,'ec.pem');fs.writeFileSync(other,generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'}));
  expect(()=>preflight({UPDATE_PRIVATE_KEY:other},publicPath)).toThrow('Ed25519');
});
