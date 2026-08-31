'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBackendEnv } = require('./fixture');

test('isolated backend disables tracing when no OTLP collector is configured', () => {
  const childEnv = buildBackendEnv({});
  assert.equal(childEnv.TRACING_ENABLED, 'false');
});
