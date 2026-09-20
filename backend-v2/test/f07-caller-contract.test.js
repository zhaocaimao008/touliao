'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const consent=require('./legal-consent.cjs');
test('shared JS test login/register explicitly send the current consent fixture',async()=>{
  const exported={exports:{}};
  const file=path.resolve(__dirname,'../../tests/utils/api.js');
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module:exported,require:name=>{
    if(name==='axios')return {};
    if(name==='../config')return {BASE_URL:'http://synthetic.invalid'};
    if(name==='../../backend-v2/test/legal-consent.cjs')return consent;
    throw Error('unexpected import');
  }});
  const post=jest.fn().mockResolvedValue({data:{ok:true}});
  await exported.exports.login({post},'13000000001','synthetic-password');
  await exported.exports.register({post},'synthetic-user','13000000002','synthetic-password');
  expect(post.mock.calls[0]).toEqual(['/api/auth/login',{phone:'13000000001',password:'synthetic-password',legalConsent:consent}]);
  expect(post.mock.calls[1]).toEqual(['/api/auth/register',{username:'synthetic-user',phone:'13000000002',password:'synthetic-password',legalConsent:consent}]);
});
test('operational scripts require explicit current version; absent/stale input never defaults to consent',()=>{
  const previous=process.env.OPS_LEGAL_CONSENT_VERSION;
  const get=require('../../ops/legal-consent.cjs');
  try{
    delete process.env.OPS_LEGAL_CONSENT_VERSION;expect(()=>get()).toThrow('BLOCKED');
    process.env.OPS_LEGAL_CONSENT_VERSION='2026-09-20';expect(()=>get()).toThrow('BLOCKED');
    process.env.OPS_LEGAL_CONSENT_VERSION=consent.privacyVersion;expect(get()).toEqual(consent);
  } finally {if(previous===undefined)delete process.env.OPS_LEGAL_CONSENT_VERSION;else process.env.OPS_LEGAL_CONSENT_VERSION=previous;}
});
