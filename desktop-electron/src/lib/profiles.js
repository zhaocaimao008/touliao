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

// 托盘「新开账号窗口」启动子进程时带的标记：所有平台均自动分配空闲账号窗口。
const NEW_WINDOW_FLAG = '--new-account-window';
const RUNNING_MARKER = '.touliao-window.pid';

function markRunningProfile(root, profile, filesystem = fs, pid = process.pid) {
  filesystem.writeFileSync(path.join(profilePath(root, profile), RUNNING_MARKER), String(pid), { flag: 'w' });
}

function unmarkRunningProfile(root, profile, filesystem = fs, pid = process.pid) {
  const marker = path.join(profilePath(root, profile), RUNNING_MARKER);
  try {
    if (filesystem.readFileSync(marker, 'utf8').trim() === String(pid)) filesystem.unlinkSync(marker);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function hasOtherRunningProfile(root, current, filesystem = fs, isAlive = pid => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}) {
  for (let profile = 1; profile <= MAX_PROFILES; profile++) {
    if (profile === current) continue;
    try {
      const pid = Number(filesystem.readFileSync(path.join(profilePath(root, profile), RUNNING_MARKER), 'utf8').trim());
      if (Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

// 启动方式：
//  explicit   = 带 --profile=N，只认领该账号窗口（被占用则通知其实例前台显示）；
//  new-window = 托盘「新开账号窗口」，从 1 起分配第一个空闲账号窗口；
//  default    = Windows 桌面图标/开始菜单自动分配空闲窗口；其他平台仍只唤起账号窗口 1。
//  开机自启显式带 --profile=1，避免重启时无意新开空白账号窗口。
function launchMode(args) {
  if (args.some(arg => arg.startsWith('--profile='))) return 'explicit';
  if (args.includes(NEW_WINDOW_FLAG)) return 'new-window';
  return 'default';
}

function claimProfile(app, root, args, filesystem = fs, platform = process.platform) {
  const first = profileFromArgs(args);
  const mode = launchMode(args);
  const automaticWindow = mode === 'new-window' || (mode === 'default' && platform === 'win32');
  const last = automaticWindow ? MAX_PROFILES : first;
  // Electron releases a failed native lock, so the same process can try the next directory.
  // Acquire before loading Store/logging/Chromium to avoid touching an occupied profile.
  // automaticWindow 随锁请求传给已占用实例的 second-instance：分配探测不抢焦点，其余唤起窗口。
  for (let profile = first; profile <= last; profile++) {
    const directory = profilePath(root, profile);
    filesystem.mkdirSync(directory, { recursive: true });
    app.setPath('userData', directory);
    app.setPath('sessionData', directory);
    if (app.requestSingleInstanceLock({ automaticWindow })) return profile;
  }
  return null;
}

function loginItemSettings(openAtLogin, platform = process.platform) {
  return platform === 'win32'
    ? { openAtLogin, args: ['--profile=1'] }
    : { openAtLogin };
}

// Windows 的自动多开可能复用已关闭窗口的目录；“新开”必须先清除该目录的旧账号身份。
// 显式 --profile=N 是恢复指定账号窗口，主窗口 1 也保留原有登录态。
function shouldClearNewWindowLogin(profile, args, platform = process.platform, otherRunning = false) {
  const mode = launchMode(args);
  return mode === 'new-window' || (platform === 'win32' && mode === 'default' && (profile > 1 || otherRunning));
}

module.exports = { MAX_PROFILES, NEW_WINDOW_FLAG, launchMode, profileFromArgs, profilePath, claimProfile, loginItemSettings, shouldClearNewWindowLogin, markRunningProfile, unmarkRunningProfile, hasOtherRunningProfile };
