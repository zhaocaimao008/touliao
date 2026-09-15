'use strict';
const BatchAckManager = require('../src/utils/batchAckManager');
const { redis } = require('../src/utils/redis');

test('ACKs arriving while Redis is flushing survive in their own pending batch', async () => {
  const manager = new BatchAckManager({ batchTimeout: 60000 });
  let complete;
  const pipeline = { sadd: jest.fn(), expire: jest.fn(), setex: jest.fn(), exec: jest.fn(() => new Promise(resolve => { complete = resolve; })) };
  const spy = jest.spyOn(redis, 'pipeline').mockReturnValue(pipeline);
  try {
    await manager.addToBatch('read', 'first', 'reader');
    const flush = manager.processBatch('batch:read:reader');
    await manager.addToBatch('read', 'second', 'reader');
    complete([]);
    expect(await flush).toEqual({ processed: 1, type: 'read' });
    expect(manager.pendingBatches.get('batch:read:reader').items.map(item => item.messageId)).toEqual(['second']);
  } finally {
    for (const batch of manager.pendingBatches.values()) clearTimeout(batch.timer);
    spy.mockRestore();
  }
});
