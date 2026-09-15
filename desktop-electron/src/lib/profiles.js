'use strict';
const path = require('path');

const MAX_PROFILES = 5;

function profileFromArgs(args) {
  const option = args.find(arg => arg.startsWith('--profile='));
  if (!option) return 1;
  if (!/^--profile=[1-5]$/.test(option)) throw new Error('Invalid account window; use --profile=1 through --profile=5');
  return Number(option.slice('--profile='.length));
}

function profilePath(root, profile) {
  if (!Number.isInteger(profile) || profile < 1 || profile > MAX_PROFILES) throw new Error('Invalid account window');
  // Preserve the original installation's login and settings in window 1.
  return profile === 1 ? root : path.join(root, 'profiles', String(profile));
}

module.exports = { MAX_PROFILES, profileFromArgs, profilePath };
