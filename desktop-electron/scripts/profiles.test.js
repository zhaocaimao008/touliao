'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { MAX_PROFILES, NEW_WINDOW_FLAG, launchMode, profileFromArgs, profilePath, claimProfile, loginItemSettings, shouldClearNewWindowLogin } = require('../src/lib/profiles');

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

test('launch modes distinguish shortcut, tray new-window and explicit profile launches', () => {
  assert.equal(launchMode(['app.exe']), 'default');
  assert.equal(launchMode(['app.exe', NEW_WINDOW_FLAG]), 'new-window');
  assert.equal(launchMode(['app.exe', '--profile=3']), 'explicit');
  assert.equal(launchMode(['app.exe', NEW_WINDOW_FLAG, '--profile=3']), 'explicit');
});

test('each Windows desktop shortcut launch claims a separate profile without focusing occupied windows', () => {
  const occupied = new Set();
  for (let expected = 1; expected <= 4; expected++) {
    const f = fixture(occupied);
    assert.equal(claimProfile(f.app, '/data', ['app.exe'], f.filesystem, 'win32'), expected);
    assert.equal(f.paths.userData, profilePath('/data', expected));
    assert.equal(f.paths.sessionData, f.paths.userData);
    assert.ok(f.attempts.every(attempt => attempt.automaticWindow));
  }
});

test('a default launch on other platforms still wakes window 1', () => {
  const f = fixture(new Set([profilePath('/data', 1)]));
  assert.equal(claimProfile(f.app, '/data', ['app.exe'], f.filesystem, 'linux'), null);
  assert.deepEqual(f.attempts, [{ directory: profilePath('/data', 1), automaticWindow: false }]);
});

test('Windows login startup is pinned to profile 1', () => {
  assert.deepEqual(loginItemSettings(true, 'win32'), { openAtLogin: true, args: ['--profile=1'] });
  assert.deepEqual(loginItemSettings(false, 'win32'), { openAtLogin: false, args: ['--profile=1'] });
  assert.deepEqual(loginItemSettings(true, 'linux'), { openAtLogin: true });
});

test('automatic Windows secondary windows start without a previous account login', () => {
  assert.equal(shouldClearNewWindowLogin(2, ['app.exe'], 'win32'), true);
  assert.equal(shouldClearNewWindowLogin(3, ['app.exe', NEW_WINDOW_FLAG], 'win32'), true);
  assert.equal(shouldClearNewWindowLogin(1, ['app.exe'], 'win32'), false);
  assert.equal(shouldClearNewWindowLogin(2, ['app.exe', '--profile=2'], 'win32'), false);
  assert.equal(shouldClearNewWindowLogin(2, ['app.exe', NEW_WINDOW_FLAG], 'linux'), false);
});

test('each tray new-window launch claims a different native lock, beyond five windows', () => {
  const occupied = new Set();
  for (let expected = 1; expected <= 6; expected++) {
    const f = fixture(occupied);
    assert.equal(claimProfile(f.app, '/data', ['app.exe', NEW_WINDOW_FLAG], f.filesystem), expected);
    assert.equal(f.paths.userData, profilePath('/data', expected));
    assert.equal(f.paths.sessionData, f.paths.userData);
    assert.ok(f.attempts.every(attempt => attempt.automaticWindow));
  }
});

test('a released profile is reused without deleting its persistent data', () => {
  const f = fixture(new Set([profilePath('/data', 1), profilePath('/data', 3)]));
  assert.equal(claimProfile(f.app, '/data', ['app.exe', NEW_WINDOW_FLAG], f.filesystem), 2);
});

test('an explicit occupied profile only notifies its owner, never allocates another', () => {
  const f = fixture(new Set([profilePath('/data', 2)]));
  assert.equal(claimProfile(f.app, '/data', ['app.exe', '--profile=2'], f.filesystem), null);
  assert.deepEqual(f.attempts, [{ directory: profilePath('/data', 2), automaticWindow: false }]);
});

test('allocation has a bounded failure path when every profile is occupied', () => {
  const f = fixture(new Set(Array.from({ length: MAX_PROFILES }, (_, i) => profilePath('/data', i + 1))));
  assert.equal(claimProfile(f.app, '/data', ['app.exe', NEW_WINDOW_FLAG], f.filesystem), null);
  assert.equal(f.attempts.length, MAX_PROFILES);
  const shortcut = fixture(new Set(Array.from({ length: MAX_PROFILES }, (_, i) => profilePath('/data', i + 1))));
  assert.equal(claimProfile(shortcut.app, '/data', ['app.exe'], shortcut.filesystem, 'win32'), null);
  assert.equal(shortcut.attempts.length, MAX_PROFILES);
});

test('filesystem failures abort allocation instead of falling back to shared data', () => {
  const f = fixture();
  assert.throws(() => claimProfile(f.app, '/data', ['app.exe'], {
    mkdirSync() { throw new Error('read only'); },
  }), /read only/);
  assert.equal(f.attempts.length, 0);
});
