# 品牌资产替换前备份清单（BRAND_ASSET_BACKUP_MANIFEST）

- 备份时间：2026-09-28T13:45:17Z
- 代码基线：main @ 6882f063
- 备份目录：`backup/brand-assets-before-new-icon/`（保持原相对路径）
- 恢复方法：`cp -a backup/brand-assets-before-new-icon/<原路径> <原路径>`，或 `git checkout 6882f063 -- <原路径>`

| 原路径 | 平台 | 用途 | SHA256 |
|---|---|---|---|
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-20.png` | iOS | App 图标 | `524151144a011418c34e19c9a4d95f2aaa149aeed1208d357cd1d48c8ace3b33` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-29.png` | iOS | App 图标 | `35e709301cda7d29fdf6421fde9f4f20e2c3628545836f2b9016b9d684098f35` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-40.png` | iOS | App 图标 | `d5bda91fdf8a7d480cb196f4ce3da95f91969f26ec4c7368bb2e32e55a4cf234` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-58.png` | iOS | App 图标 | `c510fb7ccfbb32b7f92320b1701471d0320531fa6c2a46ee0c17d174aa0241cd` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-60.png` | iOS | App 图标 | `4f80a3845929f2a204cae333896a009ec6c5bf18e93346f1df3d928b33fc281c` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-76.png` | iOS | App 图标 | `e2710bae294a143631fb44830e7c797c10ba2edcdc6720c1efdc80b1b8720cbf` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-80.png` | iOS | App 图标 | `aa4bd4691500e253e5db3ff6503bfaca095ec004ab7c991149ff5618f46df5e1` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-87.png` | iOS | App 图标 | `6b99358b69cd1f5e2d5ce471ff7d04f4ccf024fa01f702762198014b377d2879` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-120.png` | iOS | App 图标 | `7633e6aefcfc66fd32bb0c4bf90f8c121b8ae98895a0340f2f455105a965cc6b` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-152.png` | iOS | App 图标 | `21a504c7dfea674a4a193d1a3eb9fe9d1846e999249e771b04ef30466c8b5868` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-167.png` | iOS | App 图标 | `103b49bea7bdf8a1cd3f907637a188811ad9d77b7f9fea09216ad9d913b61b69` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-180.png` | iOS | App 图标 | `af9c8e18c1896eb1a96e7a4a7394ab8ffa2daa01cd60218e4c707784f239322c` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | iOS | App 图标（App Store） | `d50a5b73eeef2cfecbdc4d4fa22ed7e614122cb5c79492a765e42c34df9dc3bb` |
| `ios/Touliao/Assets.xcassets/AppIcon.appiconset/Contents.json` | iOS | AppIcon 清单 | `9a3904d0beb7b8bb52ae13a310ac29e28d2fcf13eeffe357a78516aa6eff453c` |
| `ios/project.yml` | iOS | Info.plist 生成配置（UILaunchScreen 启动页） | `255c49643fbc79202a58e2622e1f20eae1d5c3aebfd5e28e95a75b3a1298f9b0` |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` | Android | 自适应图标定义 | `5056b7226b3f58e65a61739e8ab6f5c52099fccee3ae9aad0e8856f31709e3fa` |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml` | Android | 自适应圆形图标定义 | `5056b7226b3f58e65a61739e8ab6f5c52099fccee3ae9aad0e8856f31709e3fa` |
| `android/app/src/main/res/drawable/ic_notification.xml` | Android | 通知小图标 | `34eac0c07e337fc44f8df3337203196aee7f15f6feb60af64885e871c1d97dcb` |
| `android/app/src/main/res/values/themes.xml` | Android | SplashScreen 主题（浅色） | `1149c1230727e1f3ddd2391ea9a3dac61fe8cfdc9d95a263b01e0c6a5ce218e5` |
| `android/app/src/main/res/values-night/themes.xml` | Android | SplashScreen 主题（深色） | `6915ba2458d9060d909619bb68d4f7cf1f01098aba279e73954b7094894b3bc7` |
| `desktop-electron/assets/icon.ico` | Windows | exe/安装/卸载/快捷方式/任务栏图标 | `872d25bb7cdbeb08bd119af2f5d71a897967af1367a35cb63756f934972d3bcf` |
| `desktop-electron/assets/icon.png` | Windows | 窗口图标/托盘图标 | `e0b33cb95d3895de22db07198906b771c7904d3e963ca45e46e3e64e84569f60` |
| `desktop-electron/assets/icon-1024.png` | Windows | 高分辨率图标 | `dbf5ecc809a2b7e32e6612483ecec2612c0d0d9ccd2f734b63eb3aee6135c8f2` |
| `web/public/favicon.png` | Web | favicon | `d3f3fa4eb2575982ed2c85de6717efecbbfce4c6251506b7398956cb540d93fa` |
| `web/public/icon.png` | Web | 登录页 Logo + Service Worker 预缓存 | `217a79747c183bb2f547d126411d4f3c5c2324d84251d16ae1328a987e43d379` |
| `web/public/icon.webp` | Web | 登录页 Logo（WebP） | `ba36213ce9f6b615c284d691e2c0ee2b2bc64b12f7109c019f26c05074c8f2c5` |
| `web/public/icon-512.png` | Web | 512 图标 | `a3bc903a3de137360582b373f9a47f666e9272931681b1c44eb7782d0b23b349` |
| `web/public/icons/icon-192.png` | Web/PWA | PWA 192 + apple-touch-icon | `217a79747c183bb2f547d126411d4f3c5c2324d84251d16ae1328a987e43d379` |
| `web/public/icons/icon-512.png` | Web/PWA | PWA 512（any/maskable） | `a3bc903a3de137360582b373f9a47f666e9272931681b1c44eb7782d0b23b349` |
| `web/public/manifest.json` | Web/PWA | PWA manifest | `f7bdd7831e9d31181597da523596bbde5bb64bf2a085a86bac7de0279e233913` |
| `web/index.html` | Web | favicon/apple-touch-icon 引用 | `b6ec116790f6b77c745a0ad812b5cc2a857264a4e90ba7cbc30806e7db8dc263` |
| `web/public/sw.js` | Web/PWA | Service Worker（缓存版本） | `25299f3b50ed4fe3f3263cab855c85123fc644c14cd8c621470241c9cf532bbc` |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | Android | 启动器图标(mdpi ) | `85c01e219800d9fad237fbec8f3aa927374836904058b352ba06496500b89ae7` |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png` | Android | 启动器图标(mdpi _round) | `85c01e219800d9fad237fbec8f3aa927374836904058b352ba06496500b89ae7` |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png` | Android | 启动器图标(mdpi _foreground) | `3360f6ff0abb6ee029387a55978852437bb1699279bad00ad080e25bc9ba3acb` |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | Android | 启动器图标(hdpi ) | `5ff67ec45e959688d1425f6453fa139ff1e944c1bc1b1e74b43465618106ffc0` |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png` | Android | 启动器图标(hdpi _round) | `5ff67ec45e959688d1425f6453fa139ff1e944c1bc1b1e74b43465618106ffc0` |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png` | Android | 启动器图标(hdpi _foreground) | `74dc13516d255714630892a23bef203baae66d2212f17bf3d26378844b1d5839` |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | Android | 启动器图标(xhdpi ) | `b43b2250b56a0cb160cb7f555726da01401364c90a05616027ee38a3b8233e63` |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png` | Android | 启动器图标(xhdpi _round) | `b43b2250b56a0cb160cb7f555726da01401364c90a05616027ee38a3b8233e63` |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png` | Android | 启动器图标(xhdpi _foreground) | `f2f2fca5264357550f35619dbdbd40fcbaa179a28056987b8af057f45fb40677` |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | Android | 启动器图标(xxhdpi ) | `a57d6c8ac2360becf88958ca7a3ba3a7daa3643dd5bea753f849376f84f96188` |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png` | Android | 启动器图标(xxhdpi _round) | `a57d6c8ac2360becf88958ca7a3ba3a7daa3643dd5bea753f849376f84f96188` |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png` | Android | 启动器图标(xxhdpi _foreground) | `e1d82730b4669f1e52b571e0b6a7a1cce10a9ed5a4a6111054ec2b901b7d55ab` |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | Android | 启动器图标(xxxhdpi ) | `217a79747c183bb2f547d126411d4f3c5c2324d84251d16ae1328a987e43d379` |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png` | Android | 启动器图标(xxxhdpi _round) | `217a79747c183bb2f547d126411d4f3c5c2324d84251d16ae1328a987e43d379` |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` | Android | 启动器图标(xxxhdpi _foreground) | `ce8a681532ddd4aadec2fb5e5b8dad271bec7de3bc510cbe85e2e885202b1a20` |
