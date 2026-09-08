'use strict';
const { createVitalsBuffer } = require('../src/utils/vitalsBuffer');
const { app, request, makeUser } = require('./helpers');
test('retains only anonymous metrics, bounded to sample and retention window',()=>{
  let time=0;const b=createVitalsBuffer({max:2,retentionMs:100,random:()=>0,now:()=>time});
  for(let i=0;i<3;i++)b.add({name:'LCP',value:i,url:'https://private/?token=secret',userAgent:'sensitive',userId:'private'});
  expect(b.recent().map(r=>r.value)).toEqual([1,2]);expect(JSON.stringify(b.recent())).not.toMatch(/private|secret|sensitive/);
  time=100;expect(b.recent()).toEqual([]);
});
test('sampling rejects unselected reports without retaining payload',()=>{
  const b=createVitalsBuffer({random:()=>0.9});expect(b.add({name:'CLS',value:0.1})).toBe(true);expect(b.recent()).toEqual([]);
});
test.each([{name:'bogus',value:1},{name:'LCP',value:-1},{name:'LCP',value:Infinity},{name:'LCP',value:'secret'}])('invalid vital rejected: %j',body=>{
  const b=createVitalsBuffer({random:()=>0});expect(b.add(body)).toBe(false);expect(b.recent()).toEqual([]);
});
test('recent vitals rejects anonymous and normal user access',async()=>{
  await request(app).get('/api/metrics/vitals/recent').expect(401);
  const u=await makeUser();await request(app).get('/api/metrics/vitals/recent').set('Authorization',`Bearer ${u.token}`).expect(401);
  await request(app).post('/api/metrics/vitals').send({name:'LCP',value:10}).expect(204);
});
