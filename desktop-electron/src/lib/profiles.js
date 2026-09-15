'use strict';
const path = require('path');
const fs = require('fs');

const MAX_PROFILES = 100;

function profileFromArgs(args) {
  const option = args.find(arg => arg.startsWith('--profile='));
  if (!option) return 1;
  const value = option.slice('--profile='.length);
  const profile = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isInteger(profile) || profile > MAX_PROFILES) {
    throw new Error(`Invalid account window; use --profile=1 through --profile=${MAX_PROFILES}`);
  }
  return profile;
}

function profilePath(root, profile) {
  if (!Number.isInteger(profile) || profile < 1 || profile > MAX_PROFILES) throw new Error('Invalid account window');
  // Preserve the original installation's login and settings in window 1.
  return profile === 1 ? root : path.join(root, 'profiles', String(profile));
}

function claimProfile(app, root, args, filesystem = fs) {
  const first = profileFromArgs(args);
  const automaticWindow = !args.some(arg => arg.startsWith('--profile='));
  const last = automaticWindow ? MAX_PROFILES : first;
  // Electron releases a failed native lock, so the same process can try the next directory.
  // Acquire before loading Store/logging/Chromium to avoid touching an occupied profile.
  for (let profile = first; profile <= last; profile++) {
    const directory = profilePath(root, profile);
    filesystem.mkdirSync(directory, { recursive: true });
    app.setPath('userData', directory);
    app.setPath('sessionData', directory);
    if (app.requestSingleInstanceLock({ automaticWindow })) return profile;
  }
  return null;
}

module.exports = { MAX_PROFILES, profileFromArgs, profilePath, claimProfile };
