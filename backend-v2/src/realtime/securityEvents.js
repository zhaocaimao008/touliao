'use strict';
const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const bus = new EventEmitter();
const origin = randomUUID();
const channel = 'touliao:security:revoke';
let publisher, subscriber, ready, reconnectTimer;
function init() {
  if (!process.env.REDIS_URL) return Promise.resolve();
  if (ready && publisher?.status !== 'end' && subscriber?.status !== 'end') return ready;
  publisher?.disconnect(); subscriber?.disconnect();
  const Redis = require('ioredis');
  publisher = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 1000, retryStrategy: n => n > 2 ? null : n * 100, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  subscriber = publisher.duplicate({ lazyConnect: true });
  for (const c of [publisher, subscriber]) c.on('error', e => console.error('[securityEvents] Redis:', e.message));
  subscriber.on('message', (_, raw) => {
    try { const e = JSON.parse(raw); if (e.origin !== origin && typeof e.userId === 'string') bus.emit('revoke', e); }
    catch (e) { console.error('[securityEvents] invalid event:', e.message); }
  });
  ready = Promise.all([publisher.connect(), subscriber.connect()]).then(() => subscriber.subscribe(channel));
  return ready;
}
function revoke(userId, sessionIds = null) {
  const event = { origin, userId, sessionIds };
  bus.emit('revoke', event);
  return init().then(() => publisher?.publish(channel, JSON.stringify(event))).catch(e => {
    console.error('[securityEvents] publication failed; durable auth checks remain active:', e.message);
  });
}
function bind(io) {
  const handler = ({ userId, sessionIds }) => {
    const rooms = sessionIds ? sessionIds.map(id => `session_${id}`) : [`user_${userId}`];
    for (const room of rooms) io.to(room).disconnectSockets(true);
  };
  bus.on('revoke', handler);
  const connect = () => init().catch(e => console.error('[securityEvents] subscribe failed:', e.message));
  connect();
  if (process.env.REDIS_URL && !reconnectTimer) { reconnectTimer = setInterval(connect, 5000); reconnectTimer.unref(); }
  if (typeof io.close === 'function') {
    const close = io.close.bind(io);
    io.close = (...args) => { bus.off('revoke', handler); return close(...args); };
  }
}
async function close() {
  clearInterval(reconnectTimer); reconnectTimer = null;
  for (const c of [publisher, subscriber]) c?.disconnect();
  publisher = subscriber = ready = null;
}
module.exports = { revoke, bind, close, ready: init };
