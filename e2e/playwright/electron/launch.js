'use strict';
const { _electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const env = require('../../shared/env');

const DESKTOP_DIR = path.join(env.REPO_ROOT, 'desktop-electron');

/**
 * 启动 desktop-electron(它 loadFile web/dist/index.html)。
 * 前置:必须先 `cd web && npm run build` 生成 web/dist。
 * 让 Electron 连测试后端:通过 args 传一个临时 user-data + 预置 localStorage。
 * Electron 用 HashRouter,登录路径 /#/login。
 *
 * 注意(本机 headless):需 xvfb。CI/无显示器环境用:
 *   xvfb-run -a npm run test:electron
 */
/**
 * 是否应跳过 Electron 测试。返回原因字符串或 null。
 * desktop-electron/src/main.js 调用了 app.enableSandbox()(生产安全配置),
 * 在 root 环境下 Electron 强制要求沙箱却不支持 root → FATAL,无法以 root 跑。
 * 非 root 桌面/CI 用户正常。
 */
function skipReason() {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return 'root 环境:main.js enableSandbox() 与 Electron root 沙箱限制冲突,请用非 root 用户运行';
  }
  const dist = path.join(env.REPO_ROOT, 'web', 'dist', 'index.html');
  if (!fs.existsSync(dist)) return 'web/dist 不存在,先 npm run build:web';
  return null;
}

async function launchElectron() {
  const dist = path.join(env.REPO_ROOT, 'web', 'dist', 'index.html');
  if (!fs.existsSync(dist)) {
    throw new Error('web/dist 不存在,先运行 npm run build:web');
  }
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.e2e-state.json'), 'utf8'));

  // 用 desktop-electron 自带的 electron 二进制(Playwright 默认找自己的,这里项目本地)
  const electronBin = path.join(DESKTOP_DIR, 'node_modules', 'electron', 'dist', 'electron');
  const app = await _electron.launch({
    executablePath: fs.existsSync(electronBin) ? electronBin : undefined,
    // --no-sandbox: root 环境(CI/容器)下 Electron 沙箱不支持 root,必须关。
    // 普通用户桌面跑可去掉。--disable-gpu: headless/xvfb 无 GPU。
    args: ['.', '--no-sandbox', '--disable-gpu'],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      // 让主进程跳过远程 config 拉取,直接用测试后端(main.js 的 store/默认机制)
      VXIN_SERVER_URL: state.backendUrl,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  });
  const page = await app.firstWindow();
  // Electron 渲染层登录前注入后端地址(与 web fixture 同理)
  await page.evaluate((url) => { try { localStorage.setItem('vxin_server_url', url); } catch {} }, state.backendUrl);
  return { app, page, state };
}

module.exports = { launchElectron, skipReason };
