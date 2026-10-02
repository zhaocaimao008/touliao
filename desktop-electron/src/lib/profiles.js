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

// 托盘「新开账号窗口」启动子进程时带的标记：只有它走自动分配空闲账号窗口。
const NEW_WINDOW_FLAG = '--new-account-window';

// 启动方式：
//  explicit   = 带 --profile=N，只认领该账号窗口（被占用则通知其实例前台显示）；
//  new-window = 托盘「新开账号窗口」，从 1 起分配第一个空闲账号窗口；
//  default    = 桌面图标/开始菜单/开机自启/安装后启动：只认领账号窗口 1，已在运行（含藏在托盘）
//               则通知其实例唤起窗口后退出，不再静默新开账号 2（2026-10 修：窗口在托盘时双击
//               图标开出空白的账号 2）。
function launchMode(args) {
  if (args.some(arg => arg.startsWith('--profile='))) return 'explicit';
  if (args.includes(NEW_WINDOW_FLAG)) return 'new-window';
  return 'default';
}

function claimProfile(app, root, args, filesystem = fs) {
  const first = profileFromArgs(args);
  const automaticWindow = launchMode(args) === 'new-window';
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

module.exports = { MAX_PROFILES, NEW_WINDOW_FLAG, launchMode, profileFromArgs, profilePath, claimProfile };
