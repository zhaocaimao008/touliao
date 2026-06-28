'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async () => {
  try { if (global.__E2E_WEB__) await new Promise((r) => global.__E2E_WEB__.close(r)); } catch {}
  try { if (global.__E2E_BACKEND__) await global.__E2E_BACKEND__.stop(); } catch {}
  try { fs.unlinkSync(path.join(__dirname, '..', '.e2e-state.json')); } catch {}
  console.log('[e2e] 已清理后端/web/状态');
};
