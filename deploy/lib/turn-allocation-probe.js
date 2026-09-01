'use strict';

const crypto = require('node:crypto');
const dgram = require('node:dgram');
const net = require('node:net');
const tls = require('node:tls');

const MAGIC_COOKIE = 0x2112A442;
const ATTR = { USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008, ERROR_CODE: 0x0009, REALM: 0x0014, NONCE: 0x0015, REQUESTED_TRANSPORT: 0x0019, XOR_RELAYED_ADDRESS: 0x0016 };

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
  if (type === 0x0113) {
    // ERROR-CODE attribute value: 2 reserved bytes, class byte, number byte -> code = class*100 + number.
    const raw = attrs.get(ATTR.ERROR_CODE);
    let code = 401;
    if (raw && raw.length >= 4) code = raw[2] * 100 + raw[3];
    return { type: 'error', code, realm: attrs.get(ATTR.REALM)?.toString() || '', nonce: attrs.get(ATTR.NONCE)?.toString() || '' };
  }
  if (type === 0x0103) return { type: 'success', relayed: attrs.has(ATTR.XOR_RELAYED_ADDRESS) };
  if (type === 0x0003) return { type: 'request', username: attrs.get(ATTR.USERNAME)?.toString() || '' };
  return { type: 'other' };
}

function parseUrl(raw) {
  // WHATWG URL treats non-special schemes (turn:/turns:) as opaque paths and
  // leaves hostname empty, so parse the authority manually.
  const qIndex = raw.indexOf('?');
  const noQuery = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const match = noQuery.match(/^(turn|turns):(?:\/\/)?([^/]+)$/i);
  if (!match) throw new Error(`unsupported TURN URL: ${raw}`);
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const lastColon = authority.lastIndexOf(':');
  const host = lastColon === -1 ? authority : authority.slice(0, lastColon);
  const portStr = lastColon === -1 ? '' : authority.slice(lastColon + 1);
  const isTls = scheme === 'turns';
  const params = qIndex === -1 ? null : new URLSearchParams(raw.slice(qIndex + 1));
  const transport = isTls ? 'tcp' : (params?.get('transport') || 'udp');
  if (!host) throw new Error(`unsupported TURN URL (empty host): ${raw}`);
  if (transport !== 'udp' && transport !== 'tcp') throw new Error(`unsupported TURN transport: ${transport}`);
  const port = Number(portStr || (isTls ? 5349 : 3478));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid TURN port: ${portStr || '(default)'}`);
  return { host, port, transport, isTls };
}

// Runs the full allocate exchange (unauthenticated challenge -> authenticated retry)
// over ONE socket/connection so the source port stays constant: coturn binds the
// nonce to the 5-tuple, so a new socket per step yields 438 Stale Nonce.
function runAllocate(target, username, credential, timeoutMs) {
  return new Promise((resolve, reject) => {
    let socket;
    const timer = setTimeout(() => { try { socket && socket.destroy(); } catch {} reject(new Error('TURN probe timeout')); }, timeoutMs);

    const finish = (value, error) => {
      clearTimeout(timer);
      try { socket && socket.destroy(); } catch {}
      if (error) reject(error); else resolve(value);
    };

    const onTransportError = (error) => finish(undefined, error);

    if (target.transport === 'udp') {
      socket = dgram.createSocket('udp4');
      socket.on('error', onTransportError);
      const pending = [];
      socket.on('message', message => { const next = pending.shift(); if (next) next(message); });
      const sendStep = packet => new Promise((resolveStep, rejectStep) => {
        pending.push(resolveStep);
        socket.send(packet, target.port, target.host, error => { if (error) finish(undefined, error); });
      });
      exchangeOn(sendStep, username, credential, target, finish);
    } else {
      socket = target.isTls
        ? tls.connect({ host: target.host, port: target.port, rejectUnauthorized: false })
        : net.createConnection(target.port, target.host);
      socket.on('error', onTransportError);
      const pending = [];
      const chunks = [];
      let expected = 0;
      socket.on('data', chunk => {
        chunks.push(chunk);
        const data = Buffer.concat(chunks);
        if (expected === 0 && data.length >= 20) expected = 20 + data.readUInt16BE(2);
        if (expected > 0 && data.length >= expected) {
          const message = data.subarray(0, expected);
          chunks.length = 0;
          expected = 0;
          const next = pending.shift();
          if (next) next(message);
        }
      });
      const sendStep = packet => new Promise((resolveStep, rejectStep) => {
        pending.push(resolveStep);
        socket.write(packet, error => { if (error) finish(undefined, error); });
      });
      socket.once('connect', () => exchangeOn(sendStep, username, credential, target, finish));
    }
  });
}

// challenge -> authenticated retry (fresh transaction id) -> optional 438 re-challenge,
// all on the same transport.
async function exchangeOn(sendStep, username, credential, target, finish) {
  try {
    const initial = buildAllocateRequest({ authenticated: false });
    const challengePacket = await sendStep(initial.packet);
    const challenge = parseMessage(challengePacket, initial.transactionId);
    if (challenge.type !== 'error' || challenge.code !== 401 || !challenge.realm || !challenge.nonce) return finish({ ok: false, relayed: false });

    const attempt = async (realm, nonce) => {
      const authed = buildAllocateRequest({ username, realm, nonce, password: credential, authenticated: true });
      const resultPacket = await sendStep(authed.packet);
      const result = parseMessage(resultPacket, authed.transactionId);
      const key = crypto.createHash('md5').update(`${username}:${realm}:${credential}`).digest();
      if (result.type === 'success' && result.relayed && verifyMessageIntegrity(resultPacket, key)) return { ok: true, relayed: true };
      if (result.type === 'error' && result.code === 438 && result.nonce) {
        // Stale nonce: retry once with the fresh nonce from the 438 response.
        const retried = buildAllocateRequest({ username, realm: result.realm || realm, nonce: result.nonce, password: credential, authenticated: true });
        const retryPacket = await sendStep(retried.packet);
        const retryResult = parseMessage(retryPacket, retried.transactionId);
        const retryKey = crypto.createHash('md5').update(`${username}:${result.realm || realm}:${credential}`).digest();
        if (retryResult.type === 'success' && retryResult.relayed && verifyMessageIntegrity(retryPacket, retryKey)) return { ok: true, relayed: true };
      }
      return { ok: false, relayed: false };
    };

    finish(await attempt(challenge.realm, challenge.nonce));
  } catch (error) {
    finish(undefined, error);
  }
}

async function probeTurn({ urls, username, credential, timeoutMs = 3000 }) {
  let lastError = null;
  for (const rawUrl of urls) {
    try {
      const target = parseUrl(rawUrl);
      const result = await runAllocate(target, username, credential, timeoutMs);
      if (result.ok) return result;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
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

module.exports = { buildAllocateRequest, parseMessage, parseUrl, probeTurn, verifyMessageIntegrity };
