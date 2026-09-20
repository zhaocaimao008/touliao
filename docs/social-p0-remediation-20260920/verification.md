# 本轮验证记录

仅在 `/home/ubuntu/touliao-social-p0-remediation-20260920` 与GitHub隔离runner运行。没有生产消息读写；HTTP/Socket账号均合成。结果不能外推为线上已生效。

## 实际基线与反例

- 新工作区基线9254f66b包含867bc60a及最近已验收UI成果；检查点 `checkpoint/social-p0-20260920-baseline`。
- `burn-risk-current.json`：旧接收者vanish=403，正文仍保留。
- `burn-access-before.json`：新增访问回归8失败/2通过，后续`p0-final-focused.json`为50通过。
- `burn-push-before.json`：原推送暴露正文反例失败；最终专项通过。此前无push endpoint的夹具错误不计产品反例。
- `burn-mentions-before.json`：原@查询返回已个人移除消息，最终专项通过。
- 发布Web身份76文件本轮重算全部相符；`legacy-browser-core.json`基本兼容4通过、burn负例403/仍可读。JSON的ok只代表基本兼容检查，不代表burn通过。
- Android第一次构建JDK21缺jlink，改用已有JDK17/SDK34后成功；第一次模拟器断言把placeholder误作输入，已修正测试并重跑成功。
- iOS审计基线构建成功但XCTest缺DraftStore owner参数；测试编译调用已补齐。首次24测试22通过/2失败为身份切换和异步夹具问题；最终旧缓存隐私断言失败如预期；当前24项XCTest全通过，见ios-native-final日志。

## 已完成执行

| 检查 | 精确结果 | 证据 |
|---|---|---|
| 后端完整Jest | 928 pass、0 fail、1原有skip | backend-complete.json（最终a5b1d72e）；CI 67bc0ef9 coverage为此前阶段 |
| 后端P0/同步/附件专项 | 52 pass | backend-complete.json中本轮5个专项文件 |
| Web Vitest | 268 pass | web-final.json |
| Web生产模式构建/ESLint | pass / 0 warning | web-final-build.log、web-lint-final.log |
| Android JVM | 100 pass、0 fail | android-native-current/app/build/test-results/testDebugUnitTest/*.xml |
| Android应用构建 | testDebugUnitTest assembleDebug assembleDebugAndroidTest通过 | android-current-build.log及CI |
| Android API34模拟器 | 3/3仪器化测试通过 | android-native-current/social-core-evidence/social*.txt及3张本轮截图 |
| Windows源码应用 | desktop renderer构建、真实main/preload/renderer；最终10项交互（含失败重试）、17项壳逻辑通过 | windows-native-final；CI 35493978303 |
| 新Web真实浏览器 | 最终10项通过（含持续503后恢复重试） | evidence/browser-current/browser-core.json |
| 历史清理SQL方案 | 5项合成数据库检查通过 | historical-cleanup-rehearsal.json；不是自动清理worker |

可复现入口：后端既有`npm test`/`npm run test:coverage`；Web既有`npm test`/`npm run lint -- --max-warnings=0`/`npm run build`；Android `./gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest`与`scripts/social-core/android.sh`；Windows/Web `scripts/social-core/runtime.cjs`（必须使用隔离输出目录，本工具自建本地SQLite/合成账号）；iOS `.github/workflows/ios-build.yml`的`social_core_only=true`定向模拟器任务。

## 未执行或不能外推

- 无真机通过；Android仪器化使用实际Compose/存储/VM + 测试HTTP夹具；iOS定向VM/API/存储为模拟器测试，不是双真机端到端。
- Windows源码运行不是正式安装包签名；上轮签名密钥前置缺失保留，未绕过。隔离HTTP钱包免密切换400，密码回退路径通过不代表钱包切换通过。
- 无服务器可信期限、阅读起点或全局自动清理worker；相关12项验收矩阵逐项保留规则阻断，个人墓碑后重启/重连拒绝不等于自动到期通过。
- 云存储旧签名URL、CDN旧缓存、全媒体本地缓存、备份复活风险仍在；未读取/删除真实生产日志或备份。
- SOCIAL-001/008的原生真实双Socket、全页面/后台/进程重启/连续切号矩阵待验，不能仅凭本轮新增3个原生集成用例全部关闭。

CI仅手动触发feature分支的测试/构建workflow，未触发发布/生产部署。源码SHA、任务状态和证据目录见最终报告及`ci-current.json`；历史失败记录不计入当前通过项。

最终iOS：CI 35493434948 构建/旧代码反例/当前24项定向XCTest全部完成，24 passed / 0 failed，见 `evidence/ios-native-final/`。新增001/008/011三个集成用例均通过；没有真机通过声明。

末次a5b1d72e后端修补：新增两条反例16通过/2失败（burn-copy-batch-before.json），补齐后完整回归中52项本轮专项全部通过。新Web10项、实际发布旧Web4项兼容在最终后端上重新运行通过；旧burn负例仍失败，P0不关闭。
