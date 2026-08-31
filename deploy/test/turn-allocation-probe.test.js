'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { buildAllocateRequest, parseMessage, probeTurn } = require('../lib/turn-allocation-probe');

const COOKIE = 0x2112A442;

function attr(type, value) {
  const body = Buffer.from(value);
  const padded = Buffer.alloc(Math.ceil(body.length / 4) * 4);
  body.copy(padded);
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, padded]);
}

function response(type, tx, attrs, integrityKey) {
  let body = Buffer.concat(attrs);
  const packet = Buffer.alloc(20 + body.length + (integrityKey ? 24 : 0));
  packet.writeUInt16BE(type, 0);
  packet.writeUInt16BE(body.length + (integrityKey ? 24 : 0), 2);
  packet.writeUInt32BE(COOKIE, 4);
  tx.copy(packet, 8);
  body.copy(packet, 20);
  if (integrityKey) {
    const offset = 20 + body.length;
    packet.writeUInt16BE(0x0008, offset);
    packet.writeUInt16BE(20, offset + 2);
    crypto.createHmac('sha1', integrityKey).update(packet.subarray(0, offset)).digest().copy(packet, offset + 4);
  }
  return packet;
}

test('builds an unauthenticated Allocate request with a transaction id', () => {
  const { packet, transactionId } = buildAllocateRequest({
    username: '', realm: '', nonce: '', password: '', authenticated: false,
  });
  assert.equal(packet.readUInt16BE(0), 0x0003);
  assert.equal(packet.readUInt32BE(4), COOKIE);
  assert.equal(transactionId.length, 12);
  assert.ok(packet.includes(Buffer.from([0x00, 0x19, 0x00, 0x04, 0x11, 0x00, 0x00, 0x00])));
});

test('parses a 401 challenge and requires XOR-RELAYED-ADDRESS on success', () => {
  const tx = crypto.randomBytes(12);
  const challenge = response(0x0113, tx, [attr(0x0014, 'example.org'), attr(0x0015, 'nonce')]);
  assert.deepEqual(parseMessage(challenge, tx), { type: 'error', code: 401, realm: 'example.org', nonce: 'nonce' });
  const success = response(0x0103, tx, [attr(0x0016, Buffer.from([0, 1, 0x12, 0x34, 127, 0, 0, 1]))], crypto.createHash('md5').update('user:example.org:password').digest());
  assert.equal(parseMessage(success, tx).type, 'success');
});

test('completes a local UDP 401 then authenticated relay allocation exchange', async () => {
  const server = dgram.createSocket('udp4');
  const realm = 'test.local';
  const nonce = 'nonce-value';
  const secret = 'probe-secret';
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.bind(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    server.close();
    if (error.code === 'EPERM') return;
    throw error;
  }
  server.on('message', (message, rinfo) => {
    const parsed = parseMessage(message, message.subarray(8, 20));
    const tx = message.subarray(8, 20);
    if (parsed.type === 'request' && !parsed.username) {
      server.send(response(0x0113, tx, [attr(0x0014, realm), attr(0x0015, nonce)]), rinfo.port, rinfo.address);
    } else {
      const key = crypto.createHash('md5').update(`9999999999:probe:${realm}:probe-secret`).digest();
      server.send(response(0x0103, tx, [attr(0x0016, Buffer.from([0, 1, 0x12, 0x34, 127, 0, 0, 1]))], key), rinfo.port, rinfo.address);
    }
  });
  try {
    const result = await probeTurn({
      urls: [`turn:127.0.0.1:${server.address().port}?transport=udp`],
      username: `9999999999:probe`,
      credential: secret,
      timeoutMs: 1000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.relayed, true);
  } finally {
    server.close();
  }
});
