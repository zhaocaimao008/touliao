'use strict';
const RedisStore = require('rate-limit-redis').default;
const { createClient } = require('redis');
const { ApiError } = require('./http');

// A configured shared limiter must not silently become a separate counter per process.
function createSharedStores(url, prefix = 'touliao:rl:') {
  let client;
  let connection;
  async function ready() {
    if (!client) {
      client = createClient({ url, database: 3, disableOfflineQueue: true,
        socket: { connectTimeout: 1500, reconnectStrategy: false } });
      client.on('error', () => {});
    }
    if (!client.isReady) {
      if (!connection) {
        connection = client.connect().finally(() => { connection = null; });
      }
      await connection;
    }
    return client;
  }
  function makeStore(name) {
    let store;
    let options;
    async function call(method, key) {
      try {
        await ready();
        if (!store) {
          store = new RedisStore({ prefix: `${prefix}${name}:`, sendCommand: async (...args) => (await ready()).sendCommand(args) });
          // RedisStore eagerly loads both scripts, including the optional get() script.
          store.incrementScriptSha.catch(() => {});
          store.getScriptSha.catch(() => {});
          store.init(options);
        }
        return await store[method](key);
      } catch {
        throw new ApiError(503, '限流服务暂时不可用，请稍后再试', 'RATE_LIMIT_UNAVAILABLE');
      }
    }
    return { localKeys: false, prefix: `${prefix}${name}:`,
      init(value) { options = value; },
      increment: key => call('increment', key),
      decrement: key => call('decrement', key),
      resetKey: key => call('resetKey', key),
      get: key => call('get', key),
    };
  }
  return { makeStore, async close() { if (client?.isOpen) await client.quit(); } };
}

module.exports = { createSharedStores };
