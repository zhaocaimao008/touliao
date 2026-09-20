const { db } = require('../src/db/connection');
const { randomUUID } = require('crypto');
function fixture() {
  const id = randomUUID(), a = randomUUID(), b = randomUUID();
  for (const u of [a,b]) db.prepare('INSERT INTO users(id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)').run(u,u,u,'synthetic',u);
  db.prepare("INSERT INTO conversations(id,type) VALUES (?,'group')").run(id);
  for (const [u,role] of [[a,'owner'],[b,'member']]) db.prepare('INSERT INTO conversation_members(conversation_id,user_id,role) VALUES (?,?,?)').run(id,u,role);
  return { id,a,b };
}
const messages = require('../src/modules/messages/messages.service');
const conv = require('../src/modules/conversations/conversations.service');
const sync = require('../src/modules/messages/sync.service');
const io = () => { const events=[]; return { events, to: room => ({ emit: (name,payload) => events.push({room,name,payload}) }) }; };
module.exports = { db, fixture, messages, conv, sync, io };

// Independent Node processes share the synthetic SQLite file. All reach the IPC
// barrier before the parent releases work, so this exercises OS process locking.
async function concurrentProcesses(scripts) {
 const {spawn}=require('child_process');
 const children=[],exits=[];
 try {
  // Startup runs idempotent schema/account housekeeping. Finish it per child
  // before starting the next; the tested operations are released together below.
  for (const script of scripts) {
   const child=spawn(process.execPath,['-e',`
    if(process.env.NODE_ENV!=='test'||!process.env.DB_PATH.includes('.tmp-test-db.sqlite')) throw Error('isolated DB required');
    require(${JSON.stringify(require.resolve('../src/utils/push'))}).pushNewMessage=async()=>{};
    process.on('message',async()=>{try{${script};process.exit(0)}catch(e){console.error(e);process.exit(1)}});
    process.send('ready');
   `],{cwd:'/tmp',env:process.env,stdio:['ignore','ignore','pipe','ipc']});
   children.push(child);
   const exited=new Promise((resolve,reject)=>{
    let error='';child.stderr.on('data',data=>error+=data);
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`child exit=${code}: ${error}`)));
   });
   exited.catch(()=>{});exits.push(exited);
   await Promise.race([new Promise(resolve=>child.once('message',resolve)),exited]);
  }
  children.forEach(child=>child.send('go'));
  await Promise.all(exits);
 } finally {children.forEach(child=>{if(child.exitCode===null)child.kill()})}
}

function plaintextHits(secrets) {
 const hits=[];
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
  const quoted='"'+name.replace(/"/g,'""')+'"';
  for(const row of db.prepare(`SELECT * FROM ${quoted}`).all()) {
   if(secrets.some(secret=>JSON.stringify(row).includes(secret))) {hits.push(name);break;}
  }
 }
 return hits;
}
module.exports.concurrentProcesses=concurrentProcesses;
module.exports.plaintextHits=plaintextHits;
