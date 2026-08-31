'use strict';

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const net = require('node:net');

const MAGIC_COOKIE = 0x2112A442;
const ATTR = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, REALM: 0x0014, NONCE: 0x0015, REQUESTED_TRANSPORT: 0x0019, XOR_RELAYED_ADDRESS: 0x0016 };

function padded(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const out = Buffer.alloc(Math.ceil(body.length / 4) * 4);
  body.copy(out);
  return out;
}

function attribute(type, value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, padded(body)]);
}

function buildAllocateRequest({ username = '', realm = '', nonce = '', password = '', authenticated = false, transactionId = crypto.randomBytes(12) }) {
  const attrs = [attribute(ATTR.REQUESTED_TRANSPORT, Buffer.from([17, 0, 0, 0]))];
  if (authenticated) {
    attrs.push(attribute(ATTR.USERNAME, username), attribute(ATTR.REALM, realm), attribute(ATTR.NONCE, nonce));
  }
  const body = Buffer.concat(attrs);
  const packet = Buffer.alloc(20 + body.length);
  packet.writeUInt16BE(0x0003, 0);
  packet.writeUInt16BE(body.length, 2);
  packet.writeUInt32BE(MAGIC_COOKIE, 4);
  transactionId.copy(packet, 8);
  body.copy(packet, 20);
  if (authenticated) {
    const key = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest();
    const length = packet.length + 24 - 20;
    packet.writeUInt16BE(length, 2);
    const digest = crypto.createHmac('sha1', key).update(packet).digest();
    const mi = attribute(ATTR.MESSAGE_INTEGRITY, digest);
    return { packet: Buffer.concat([packet, mi]), transactionId };
  }
  return { packet, transactionId };
}

function parseAttributes(packet) {
  const attrs = new Map();
  let offset = 20;
  while (offset + 4 <= packet.length) {
    const type = packet.readUInt16BE(offset);
    const length = packet.readUInt16BE(offset + 2);
    const end = offset + 4 + length;
    if (end > packet.length) break;
    attrs.set(type, packet.subarray(offset + 4, end));
    offset += 4 + Math.ceil(length / 4) * 4;
  }
  return attrs;
}

function verifyMessageIntegrity(packet, key) {
  let offset = 20;
  while (offset + 4 <= packet.length) {
    const type = packet.readUInt16BE(offset);
    const length = packet.readUInt16BE(offset + 2);
    const end = offset + 4 + length;
    if (end > packet.length) return false;
    if (type === ATTR.MESSAGE_INTEGRITY) {
      if (length !== 20) return false;
      const signed = Buffer.from(packet.subarray(0, offset));
      signed.writeUInt16BE(offset - 20 + 24, 2);
      const expected = crypto.createHmac('sha1', key).update(signed).digest();
      return crypto.timingSafeEqual(expected, packet.subarray(offset + 4, end));
    }
    offset += 4 + Math.ceil(length / 4) * 4;
  }
  return false;
}

function parseMessage(packet, expectedTransactionId) {
  if (!Buffer.isBuffer(packet) || packet.length < 20 || packet.readUInt32BE(4) !== MAGIC_COOKIE) return { type: 'invalid' };
  const tx = packet.subarray(8, 20);
  if (expectedTransactionId && !tx.equals(expectedTransactionId)) return { type: 'invalid' };
  const attrs = parseAttributes(packet);
  const type = packet.readUInt16BE(0);
  if (type === 0x0113) return { type: 'error', code: attrs.get(0x0009)?.readUInt16BE(2) || 401, realm: attrs.get(ATTR.REALM)?.toString() || '', nonce: attrs.get(ATTR.NONCE)?.toString() || '' };
  if (type === 0x0103) return { type: 'success', relayed: attrs.has(ATTR.XOR_RELAYED_ADDRESS) };
  if (type === 0x0003) return { type: 'request', username: attrs.get(ATTR.USERNAME)?.toString() || '' };
  return { type: 'other' };
}

function parseUrl(raw) {
  const parsed = new URL(raw);
  if (parsed.protocol !== 'turn:') throw new Error(`unsupported TURN scheme: ${parsed.protocol}`);
  const transport = parsed.searchParams.get('transport') || 'udp';
  if (transport !== 'udp' && transport !== 'tcp') throw new Error(`unsupported TURN transport: ${transport}`);
  return { host: parsed.hostname, port: Number(parsed.port || 3478), transport };
}

function exchangeUdp(target, first, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); reject(new Error('TURN probe timeout')); }, timeoutMs);
    socket.on('error', error => { clearTimeout(timer); socket.close(); reject(error); });
    socket.on('message', message => { clearTimeout(timer); socket.close(); resolve(message); });
    socket.send(first, target.port, target.host, error => { if (error) { clearTimeout(timer); socket.close(); reject(error); } });
  });
}

function exchangeTcp(target, first, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(target.port, target.host);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('TURN probe timeout')); }, timeoutMs);
    const chunks = [];
    socket.once('error', error => { clearTimeout(timer); reject(error); });
    socket.on('data', chunk => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.length >= 20 && data.length >= 20 + data.readUInt16BE(2)) { clearTimeout(timer); socket.destroy(); resolve(data); }
    });
    socket.once('connect', () => socket.write(first));
  });
}

async function probeTurn({ urls, username, credential, timeoutMs = 3000 }) {
  for (const rawUrl of urls) {
    const target = parseUrl(rawUrl);
    const initial = buildAllocateRequest({ authenticated: false });
    const challengePacket = target.transport === 'udp'
      ? await exchangeUdp(target, initial.packet, timeoutMs)
      : await exchangeTcp(target, initial.packet, timeoutMs);
    const challenge = parseMessage(challengePacket, initial.transactionId);
    if (challenge.type !== 'error' || challenge.code !== 401 || !challenge.realm || !challenge.nonce) continue;
    const authenticated = buildAllocateRequest({ username, realm: challenge.realm, nonce: challenge.nonce, password: credential, authenticated: true, transactionId: initial.transactionId });
    const resultPacket = target.transport === 'udp'
      ? await exchangeUdp(target, authenticated.packet, timeoutMs)
      : await exchangeTcp(target, authenticated.packet, timeoutMs);
    const result = parseMessage(resultPacket, authenticated.transactionId);
    const key = crypto.createHash('md5').update(`${username}:${challenge.realm}:${credential}`).digest();
    if (result.type === 'success' && result.relayed && verifyMessageIntegrity(resultPacket, key)) return { ok: true, relayed: true };
  }
  return { ok: false, relayed: false };
}

if (require.main === module) {
  const urls = (process.env.TURN_PROBE_URL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!process.env.TURN_PROBE_USERNAME || !process.env.TURN_PROBE_CREDENTIAL || urls.length === 0) {
    console.error('TURN relay allocation: FAIL (configuration)'); process.exit(1);
  }
  probeTurn({ urls, username: process.env.TURN_PROBE_USERNAME, credential: process.env.TURN_PROBE_CREDENTIAL })
    .then(result => { console.log(result.ok ? 'TURN relay allocation: PASS' : 'TURN relay allocation: FAIL'); process.exit(result.ok ? 0 : 1); })
    .catch(() => { console.error('TURN relay allocation: FAIL'); process.exit(1); });
}

module.exports = { buildAllocateRequest, parseMessage, probeTurn, verifyMessageIntegrity };
