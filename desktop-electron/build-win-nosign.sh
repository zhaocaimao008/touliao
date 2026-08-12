#!/bin/bash

# 跳过代码签名，生成未签名的 Windows 可执行文件
cd /root/v信/desktop-electron

export CSC_IDENTITY_AUTO_DISCOVERY=false
export WIN_CSC_LINK=""
export WIN_CSC_KEY_PASSWORD=""

# 修改环境变量禁用签名
export ELECTRON_BUILDER_SKIP_RECODE_SIGNING=true

npm run build:web

# 手动调用 electron-builder，跳过签名步骤
npx electron-builder --win --x64 \
  --config.win.certificateFile= \
  --config.win.certificatePassword= \
  --config.win.signingHashAlgorithms= \
  --config.win.sign=

