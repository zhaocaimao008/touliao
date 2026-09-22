'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const sharp=require('sharp');
const shutdownWriterBeforeModuleReset=require('./shutdownWriterBeforeModuleReset');
const {app,request,makeUser,privateConversation,befriend}=require('./f02-inprocess-http.cjs');
const {db}=require('../src/db/connection');
const config=require('../src/config');
let a,b,cid,png;
const auth=req=>req.set('Authorization',`Bearer ${a.token}`);
beforeAll(async()=>{
  a=await makeUser({username:'f13-media-a'});b=await makeUser({username:'f13-media-b'});await befriend(a,b);cid=await privateConversation(a,b);
  png=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();
});
afterAll(async()=>{await require('../src/db/writer').shutdown();});
test.each(['/api/users/avatar','/api/users/cover','/api/moments/images','/api/moments/video'])('visual endpoint %s rejects without claiming a review',async url=>{
  expect((await request(app).post(url)).status).toBe(401);
  const r=await auth(request(app).post(url));expect(r.status).toBe(503);expect(r.body.error_code).toBe('MEDIA_MODERATION_UNAVAILABLE');
});
test.each([['synthetic.png','image/png'],['disguised.txt','text/plain']])('local upload %s checks bytes and removes refused content',async(filename,contentType)=>{
  const filesBefore=fs.readdirSync(path.join(config.uploadsRoot,'files')).sort();
  const r=await auth(request(app).post(`/api/messages/${cid}/upload`)).attach('file',png,{filename,contentType});
  expect(r.status).toBe(503);expect(r.body.error_code).toBe('MEDIA_MODERATION_UNAVAILABLE');
  expect(db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n).toBe(0);
  expect(fs.readdirSync(path.join(config.uploadsRoot,'files')).sort()).toEqual(filesBefore);
});
test('text file and actual audio-only WebM remain allowed; a video track mislabeled as audio is rejected',async()=>{
  const r=await auth(request(app).post(`/api/messages/${cid}/upload`)).attach('file',Buffer.from('synthetic plain document'),{filename:'synthetic.txt',contentType:'text/plain'});
  expect(r.status).toBe(200);expect(r.body.type).toBe('file');
  const fixture=fs.readFileSync(path.join(__dirname,'fixtures/voice-opus.webm'));
  const voice=await auth(request(app).post(`/api/messages/${cid}/upload`)).attach('file',fixture,{filename:'voice.webm',contentType:'audio/webm;codecs=opus'});
  expect(voice.status).toBe(200);expect(voice.body.type).toBe('voice');
  const video=Buffer.from(fixture);const index=video.indexOf(Buffer.from([0x83,0x81,0x02]));expect(index).toBeGreaterThan(0);video[index+2]=1;
  const rejected=await auth(request(app).post(`/api/messages/${cid}/upload`)).attach('file',video,{filename:'voice.webm',contentType:'audio/webm'});
  expect(rejected.status).toBe(503);
  expect(db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n).toBe(2);
});
test('chunk completion refuses disguised image, clears partial files and never creates a message',async()=>{
  const hash=crypto.createHash('sha256').update(png).digest('hex');
  const init=await auth(request(app).post(`/api/messages/${cid}/upload-init`)).send({filename:'disguised.txt',size:png.length,hash,mime:'text/plain'});
  expect(init.status).toBe(200);const id=init.body.uploadId;
  const chunk=await auth(request(app).put(`/api/messages/${cid}/upload-chunk/${id}?offset=0`)).set('Content-Type','application/octet-stream').send(png);
  expect(chunk.status).toBe(200);
  const before=db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  const r=await auth(request(app).post(`/api/messages/${cid}/upload-finish/${id}`));expect(r.status).toBe(503);
  expect(db.prepare('SELECT COUNT(*) n FROM messages').get().n).toBe(before);
  expect(fs.existsSync(path.join(config.uploadsRoot,'chunks',id+'.part'))).toBe(false);
  expect(fs.existsSync(path.join(config.uploadsRoot,'chunks',id+'.meta.json'))).toBe(false);
});
describe('MP4/M4A audio containers are inspected beyond MIME and brand',()=>{
  const {mp4,box}=require('./fixtures/audio-mp4.cjs');
  const upload=(bytes,filename='voice.m4a',contentType='audio/mp4')=>auth(request(app).post(`/api/messages/${cid}/upload`)).attach('file',bytes,{filename,contentType});
  test.each(['isom','mp42','M4A '])('AAC-only %s is accepted as voice; same brand with a video track is refused',async brand=>{
    const before=db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n;
    for (const mime of ['audio/mp4','audio/x-m4a']) {
      const allowed=await upload(mp4({brand}),'voice.m4a',mime);expect(allowed.status).toBe(200);expect(allowed.body.type).toBe('voice');
    }
    const files=fs.readdirSync(path.join(config.uploadsRoot,'files')).sort();
    const rejected=await upload(mp4({brand,handlers:['soun','vide']}));
    expect(rejected.status).toBe(503);expect(rejected.body.error_code).toBe('MEDIA_MODERATION_UNAVAILABLE');
    expect(db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n).toBe(before+2);
    expect(fs.readdirSync(path.join(config.uploadsRoot,'files')).sort()).toEqual(files);
  });
  test('Safari-style audio/mp4 .mp4 with codec parameter is accepted; video declaration stays blocked',async()=>{
    expect((await upload(mp4(),'voice.mp4','audio/mp4;codecs=mp4a.40.2')).status).toBe(200);
    expect((await upload(mp4(),'video.mp4','video/mp4')).status).toBe(503);
  });
  test.each([
    ['missing tracks',()=>mp4({handlers:[]})],
    ['unknown handler',()=>mp4({handlers:['meta']})],
    ['video codec under audio handler',()=>mp4({codec:'avc1'})],
    ['truncated box',()=>mp4().subarray(0,-1)],
    ['extra video movie',()=>Buffer.concat([mp4(),box('moov',box('trak',Buffer.alloc(0)))])],
    ['fake header only',()=>mp4().subarray(0,24)],
    ['invalid extended box length',()=>Buffer.concat([mp4(),Buffer.from('00000001667265650000000000000001','hex')])],
  ])('%s fails closed without leaving a message or upload',async(_name,fixture)=>{
    const before=db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n;
    const files=fs.readdirSync(path.join(config.uploadsRoot,'files')).sort();
    expect((await upload(fixture())).status).toBe(503);
    expect(db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n).toBe(before);
    expect(fs.readdirSync(path.join(config.uploadsRoot,'files')).sort()).toEqual(files);
  });
  test.each([false,true])('chunked mp42 audio checks all tracks (video=%s) and clears staging',async video=>{
    const bytes=mp4({brand:'mp42',handlers:video?['soun','vide']:['soun']});
    const before=db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n;
    const init=await auth(request(app).post(`/api/messages/${cid}/upload-init`)).send({filename:'voice.m4a',size:bytes.length,hash:crypto.createHash('sha256').update(bytes).digest('hex'),mime:'audio/mp4'});
    expect(init.status).toBe(200);const id=init.body.uploadId;
    expect((await auth(request(app).put(`/api/messages/${cid}/upload-chunk/${id}?offset=0`)).set('Content-Type','application/octet-stream').send(bytes)).status).toBe(200);
    const r=await auth(request(app).post(`/api/messages/${cid}/upload-finish/${id}`));
    expect(r.status).toBe(video?503:200);if(!video)expect(r.body.type).toBe('voice');
    expect(db.prepare('SELECT COUNT(*) n FROM messages WHERE conversation_id=?').get(cid).n).toBe(before+(video?0:1));
    for(const ext of ['.part','.meta.json'])expect(fs.existsSync(path.join(config.uploadsRoot,'chunks',id+ext))).toBe(false);
  });
});

// Reset only after every upload test has finished using the top-level app's writer.
test('even a configured cloud provider cannot issue a PUT URL before quarantine/scanning exists',async()=>{
  const cloud=require('../src/utils/cloudStorage');
  const configured=jest.spyOn(cloud,'isConfigured').mockReturnValue(true);
  const sign=jest.spyOn(cloud,'getPresignedPutUrl').mockRejectedValue(new Error('synthetic signer must not be called'));
  // Controller destructures the provider exports; load it after the synthetic configuration spy.
  await shutdownWriterBeforeModuleReset();
  jest.resetModules();
  jest.doMock('../src/utils/cloudStorage',()=>({...cloud,isConfigured:()=>true,getPresignedPutUrl:sign}));
  const controller=require('../src/modules/upload/upload.controller');
  let error;
  await new Promise(resolve=>controller.credential({body:{filename:'synthetic.txt',contentType:'text/plain',conversationId:cid},user:{id:a.userId}}, {},err=>{error=err;resolve();}));
  expect(error?.status).toBe(503);expect(sign).not.toHaveBeenCalled();
  configured.mockRestore();sign.mockRestore();jest.dontMock('../src/utils/cloudStorage');
});
