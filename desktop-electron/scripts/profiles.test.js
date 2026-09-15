'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { profileFromArgs, profilePath } = require('../src/lib/profiles');

test('the primary window preserves the existing data directory', () => {
  assert.equal(profileFromArgs(['app.exe']), 1);
  assert.equal(profilePath('/app-data', 1), '/app-data');
});
test('named windows resolve distinct persistent data directories', () => {
  const roots = new Set();
  for (let index = 1; index <= 5; index++) {
    assert.equal(profileFromArgs(['app.exe', `--profile=${index}`]), index);
    roots.add(profilePath('/app-data', index));
  }
  assert.equal(roots.size, 5);
  assert.equal(profilePath('/app-data', 2), path.join('/app-data', 'profiles', '2'));
});
test('profile flags cannot select arbitrary files or directories', () => {
  for (const value of ['../other', '0', '6', '1.5', '', '01']) {
    assert.throws(() => profileFromArgs([`--profile=${value}`]));
  }
});
