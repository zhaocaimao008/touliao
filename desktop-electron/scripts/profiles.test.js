'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MAX_PROFILES, profileFromArgs, profilePath, claimProfile } = require('../src/lib/profiles');

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
  for (const value of ['../other', '0', String(MAX_PROFILES + 1), '1.5', '', '01']) {
    assert.throws(() => profileFromArgs([`--profile=${value}`]));
  }
});

function fixture(occupied = new Set()) {
  const attempts = [];
  const paths = {};
  return {
    attempts, paths,
    filesystem: { mkdirSync() {} },
    app: {
      setPath(name, value) { paths[name] = value; },
      requestSingleInstanceLock(data) {
        attempts.push({ directory: paths.userData, ...data });
        if (occupied.has(paths.userData)) return false;
        occupied.add(paths.userData);
        return true;
      },
    },
  };
}

test('each ordinary launch claims a different native lock, beyond five windows', () => {
  const occupied = new Set();
  for (let expected = 1; expected <= 6; expected++) {
    const f = fixture(occupied);
    assert.equal(claimProfile(f.app, '/data', ['app.exe'], f.filesystem), expected);
    assert.equal(f.paths.userData, profilePath('/data', expected));
    assert.equal(f.paths.sessionData, f.paths.userData);
    assert.ok(f.attempts.every(attempt => attempt.automaticWindow));
  }
});

test('a released profile is reused without deleting its persistent data', () => {
  const f = fixture(new Set([profilePath('/data', 1), profilePath('/data', 3)]));
  assert.equal(claimProfile(f.app, '/data', ['app.exe'], f.filesystem), 2);
});

test('an explicit occupied profile only notifies its owner, never allocates another', () => {
  const f = fixture(new Set([profilePath('/data', 2)]));
  assert.equal(claimProfile(f.app, '/data', ['app.exe', '--profile=2'], f.filesystem), null);
  assert.deepEqual(f.attempts, [{ directory: profilePath('/data', 2), automaticWindow: false }]);
});

test('allocation has a bounded failure path when every profile is occupied', () => {
  const f = fixture(new Set(Array.from({ length: MAX_PROFILES }, (_, i) => profilePath('/data', i + 1))));
  assert.equal(claimProfile(f.app, '/data', ['app.exe'], f.filesystem), null);
  assert.equal(f.attempts.length, MAX_PROFILES);
});

test('filesystem failures abort allocation instead of falling back to shared data', () => {
  const f = fixture();
  assert.throws(() => claimProfile(f.app, '/data', ['app.exe'], {
    mkdirSync() { throw new Error('read only'); },
  }), /read only/);
  assert.equal(f.attempts.length, 0);
});
