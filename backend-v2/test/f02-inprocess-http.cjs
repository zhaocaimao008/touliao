'use strict';
// Real Express routes/controllers and SQLite, without listen()/external services.
// The sandbox denies even loopback listeners. Only the HTTP transport is replaced.
const { IncomingMessage, ServerResponse } = require('http');
const { Duplex } = require('stream');
const jwt = require('jsonwebtoken');
const { db } = require('../src/db/connection');
const config = require('../src/config');
const app = require('../src/app');
let serial = 0;
async function makeUser({ username }) {
  const id = `${username}-${++serial}`;
  db.prepare('INSERT INTO users(id,username,phone,password,wechat_id) VALUES (?,?,?,?,?)').run(id, id, id, 'synthetic', id);
  return { userId: id, token: jwt.sign({ id, csrf: 'synthetic-csrf' }, config.jwtSecret, { expiresIn: '1h' }) };
}
function request(target) {
  const method = name => url => {
    const headers = {};
    let body;
    const chain = {
      set(key, value) { headers[key.toLowerCase()] = value; return chain; },
      send(value) { body = value; return chain; },
      then(resolve, reject) { return dispatch().then(resolve, reject); },
    };
    function dispatch() {
      return new Promise((resolve, reject) => {
        const socket = new Duplex({ read() {}, write(chunk, encoding, done) { done(); } });
        socket.remoteAddress = '127.0.0.1';
        const req = new IncomingMessage(socket);
        req.method = name; req.url = url; req.headers = { host: 'fixture.invalid', ...headers };
        const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
        if (bytes) { req.headers['content-type'] = 'application/json'; req.headers['content-length'] = String(bytes.length); }
        const res = new ServerResponse(req);
        const chunks = [];
        res.write = chunk => { chunks.push(Buffer.from(chunk)); return true; };
        res.end = chunk => {
          if (chunk) chunks.push(Buffer.from(chunk));
          res.finished = true; res.emit('finish'); socket.destroy();
          const text = Buffer.concat(chunks).toString();
          let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
          resolve({ status: res.statusCode, body: parsed, text, headers: res.getHeaders() });
          return res;
        };
        res.on('error', reject);
        if (bytes) req.push(bytes);
        req.push(null);
        target(req, res);
      });
    }
    return chain;
  };
  return { get: method('GET'), head: method('HEAD'), post: method('POST'), delete: method('DELETE') };
}
async function befriend(a, b) {
  for (const [u, v] of [[a, b], [b, a]]) db.prepare('INSERT INTO contacts(id,user_id,contact_id) VALUES (?,?,?)').run(`fixture-contact-${++serial}`, u.userId, v.userId);
}
async function privateConversation(a, b) {
  const id = `fixture-private-${++serial}`;
  db.prepare('INSERT INTO conversations(id,type) VALUES (?,?)').run(id, 'private');
  for (const u of [a, b]) db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES (?,?)').run(id, u.userId);
  return id;
}
module.exports = { app, request, makeUser, befriend, privateConversation };
