const builder = require('electron-builder');
const path = require('path');

const options = {
  config: {
    appId: 'com.vxin.desktop',
    productName: 'v信',
    directories: {
      output: 'dist',
      buildResources: 'assets'
    },
    files: [
      'src/**/*',
      'assets/**/*',
      {
        from: '../web/dist',
        to: 'web/dist',
        filter: ['**/*']
      }
    ],
    win: {
      target: [
        {
          target: 'nsis',
          arch: ['x64']
        },
        {
          target: 'portable',
          arch: ['x64']
        }
      ],
      icon: 'assets/icon.ico',
      certificateFile: undefined,
      certificatePassword: undefined,
      signingHashAlgorithms: undefined,
      sign: undefined,
      artifactName: 'vxin-${version}-setup.${ext}'
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'v信',
      runAfterFinish: true,
      installerIcon: 'assets/icon.ico',
      uninstallerIcon: 'assets/icon.ico'
    }
  },
  dir: true,
  win: ['nsis', 'portable']
};

builder.build(options).then(() => {
  console.log('✅ Windows 构建完成');
  process.exit(0);
}).catch((error) => {
  console.error('❌ 构建失败:', error);
  process.exit(1);
});
