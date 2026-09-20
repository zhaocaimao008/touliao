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
