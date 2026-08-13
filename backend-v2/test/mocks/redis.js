class MockRedis {
  constructor() {
    this._store = {};
  }

  async get(key) {
    const entry = this._store[key];
    if (!entry) return null;
    if (entry.expiry && Date.now() > entry.expiry) {
      delete this._store[key];
      return null;
    }
    return entry.value;
  }

  async set(key, value) {
    this._store[key] = { value: String(value) };
    return 'OK';
  }

  async setex(key, seconds, value) {
    this._store[key] = { value: String(value), expiry: Date.now() + seconds * 1000 };
    return 'OK';
  }

  async del(key) {
    delete this._store[key];
    return 1;
  }
}

module.exports = MockRedis;
