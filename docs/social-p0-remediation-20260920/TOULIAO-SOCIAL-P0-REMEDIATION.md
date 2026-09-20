# 投聊社交 P0 整改与上一轮验证补齐

日期：2026-09-20 UTC。分支 `fix/social-p0-20260920`。仅开发分支；未发布，未修改生产环境。完整日志和截图保存在 `/home/ubuntu/touliao-social-p0-remediation-20260920/`，仓库docs保存报告与脱敏摘要。

## 1. 结论及严格关闭口径

**SOCIAL-011（阅后即焚）仍为 P0、PARTIAL_RULE_BLOCKED，不能关闭。** 已修复不依赖产品歧义的个人移除访问漏洞、事件正文残留、推送预览和原生缓存恢复竞态。原生测试确认为Android模拟器3/3、iOS模拟器24/24通过。**尚无服务器自动到期截止，也没有按阅后即焚期限执行的全局清理任务。** 个人删除之后的拒绝访问通过，不等于用户要求的“到期后即使清理任务停摆也拒绝访问”已经完成。

原23项保留：5项上一轮开发验收关闭（002/003/004/007/010），18项未关闭；本轮不新增整项关闭。001/008补充实际构建、Windows应用运行和原生集成证据，但未冒充全部设备场景已通过。本轮可确认的生产修复关闭数仍为0。

本轮修复与测试提交：`edeeb9a9`（访问/缓存、测试入口）、`de19c772`（预览、引用墓碑兼容、CI验证）、`789a36c4`（iOS真实身份切换和旧缓存反例）、`a41be979`（Android准确检查输入值）、`c6fe44f9`（iOS获取旧基线并正确捕获预期失败）、`67bc0ef9`（请求失败时维持本地到期隐藏并重试）、`a5b1d72e`（个人已移除源不能新增收藏、批量撤回清编辑事件）。完整文件列表见 `evidence/changed-files.txt`。未改数据库结构、签名、自动更新或线上功能开关。


| 本轮目标 | 代码修复状态 | 自动测试状态 | 原生集成验证 | 真机验证 | 生产是否生效 |
|---|---|---|---|---|---|
| SOCIAL-011 | PARTIAL_RULE_BLOCKED；访问/缓存已修，自动期限/全局销毁未实现 | 已修子集通过；完整到期/worker验收BLOCKED | Android缓存用例通过；iOS缓存用例通过（见第6节）；Windows/Web移除及异常重试通过 | NOT_RUN | 本轮未部署，现网SHA/启用范围UNKNOWN |
| SOCIAL-001 | 上轮账号隔离实现保留；IMPLEMENTED_VALIDATION_PENDING | 草稿/身份屏障回归通过 | Android真实Compose、iOS VM结果见第6节；Windows A/B/A通过；完整后台/重启/快切矩阵未齐 | NOT_RUN | 本轮未部署，未验证生产生效 |
| SOCIAL-008 | 上轮同步实现保留；IMPLEMENTED_VALIDATION_PENDING | 双Socket与读取屏障回归通过 | Android/iOS原生联系人失效集成通过（HTTP夹具/事件注入）；Windows实际Socket与重连通过；原生双设备矩阵未齐 | NOT_RUN | 本轮未部署，未验证生产生效 |

## 2. 真实基线与生产证据

实际读取上一轮目录 `/home/ubuntu/touliao-social-core-remediation-20260920/` 的报告和CSV，以及原审计 `/home/ubuntu/touliao-social-audit-20260920T013600Z/`。未用截图替代源码。

新工作区以 `9254f66b814f689810e995e5aa7d1fa4acb3749b` 建立；Git祖先验证包含 `867bc60a08e49a4cee694dcdde8614a6b969eab6`、d376c6a、d93a861与08c67345。检查点 `checkpoint/social-p0-20260920-baseline`。没有回退UI或把其他任务分支直接合入。开始时实际已有19个工作区（用户所说18个及上一轮新增工作区），逐个保存HEAD/status/未提交文件哈希，结束再比对；本轮只在第20个独立工作区修改。

| 平台 | 已有发布基线 | 源码依据 | 本次核实范围 |
|---|---|---|---|
| Web | 8.1.24 | d93a861b617b200973c3ecc9314105faac921402 | 公开HTML与发布身份清单未变；本地旧包76文件重新哈希全部相符，并实际用于兼容测试 |
| Windows | 8.1.29 | 08c67345；上一轮签名发布证据 | 本次只读更新元数据未变；未运行旧安装包 |
| Android | 8.1.26（83） | d93a861；上一轮发布记录 | 本次只读版本清单未变；未运行旧APK |
| iOS | 上次核实TestFlight 8.1.25（1789842617） | d93a861；历史VALID/IN_BETA_TESTING记录 | 本轮未重新查询ASC，当前TestFlight状态未重新核实 |
| Server | /health version=2 | **加载提交SHA UNKNOWN** | 运行PID对应cwd可读，磁盘HEAD45dccd9963不证明进程内存加载版本；health没有commit字段 |

证据：`evidence/live-current-readonly.json`、`evidence/legacy-web-identity.json`、`evidence/worktree-protection.json`。仅GET公开版本/配置/健康元数据及读取进程cwd，没有读取真实用户私信、用户设置表或生产数据库。

公开配置仍为moments=false、collect=false、groupVoiceCall=false、groupVideoCall=false。没有公开的阅后即焚全局开关；Web/Windows在私聊设置有入口，Android/iOS聊天菜单有入口（含群聊），**当前生产实际启用用户/会话范围 UNKNOWN**。已发布Web确有问题代码，但不能据此断言已确认线上私人消息泄露事件。

## 3. SOCIAL-011 根因、现有规则和最小决策缺口

| 事项 | 已确认实现 | 不能推定的承诺 |
|---|---|---|
| 设置归属 | conversation_settings中每user_id + conversation_id的burn_after；0关闭，非0服务器限制60秒至7天；客户端10/30秒选项会被归一化为60秒，当前展示服务器真值，选择项差异仍需后续明确 | 不能把某人的个人设置视为全群统一销毁授权 |
| 计时 | Web/Windows渲染器按message.created_at（发送时间）与客户端Date.now计算；仅在页面装载时调度 | **不是已读起算**；没有服务端可信expires_at；系统时钟可影响当前触发 |
| 单聊/群聊 | Web共用相同会话定时逻辑 | 没有逐接收者阅读时间、全员已读期限或群主统一策略 |
| 原删除动作 | 定时器调用vanish；服务器只允许发送者或管理员；接收者403仍被客户端吞掉并隐藏 | 页面消失不等于数据库清除；不能开放普通接收者全局vanish解决 |
| 原生 | 有设置，主要依赖burnAfter跳过缓存；构造时先读旧缓存，异步隐私设置迟到 | 没有可靠到期定时/服务端到期处理 |
| 明确缓存承诺 | `docs/offline-message-cache-contract.md:64` 与67：“不入缓存”“绝不落盘”（该文档定义的本地历史缓存） | 不等于承诺清掉系统相册、所有媒体缓存、第三方推送及备份 |
| 数据保留位置 | 隔离复现messages.content原文仍在；未正确删除时FTS/事件/查询也仍有合法数据源；旧编辑事件payload可含原文（单条和批量路径均已补清理） | 未检查生产私信、日志正文或备份；不能声称所有线上存储都已验证 |

代码：`backend-v2/src/db/schema.js:462`；`modules/conversations/conversations.service.js:468`；`web/src/components/ChatWindow.jsx:411`；`backend-v2/src/modules/messages/messages.service.js:474`。实际阅读/ACK不构成服务器到期触发；本轮没有改变已读水位和消息期限。全文文档扫描证据为 `evidence/burn-documentation-scan.txt`，没有找到另一份定义服务器销毁时钟的产品契约。

隔离复现：接收者设60秒，消息年龄300秒，旧vanish请求403，messages.deleted仍0且正文保留；`evidence/burn-risk-current.json`。旧已发布Web与新服务端实跑也复现403和bodyStillReadable=true（`legacy-browser-core.json.knownLimitations`）。这些是合成账号的代码/运行证据，**不是生产事件取证**。

最小待决策事项（本轮不擅自给出产品答案）：

1. 起点为发送、送达、首个有权阅读还是各设备/各接收者阅读；客户端上报只可作为信号，未来截止必须采用服务器时间。
2. 是个人副本截止还是整条消息共享截止；发送者保留、群内未读者、退群/新成员怎样处理。
3. 设置是否影响已有历史；调长、关闭后能否改变已经锁定期限。不能默认复活已到期内容。
4. 正文、附件、缩略图、引用/收藏/转发独立副本的保留边界；访问截止与物理清理SLA；日志、备份、旧链接和旧端升级说明。

因此未引入新的数据库期限字段、全局清理任务或回填历史期限。已有markRead只对成员写已读状态（conversations.service.js:410），无权者返回空结果，不创建阅后即焚截止。阅读/ACK重复不会修改一个尚不存在的服务端期限；**这不是重复阅读的到期语义已验收**。

## 4. 本轮最小修复及精确证据

### 4.1 Web/Windows：正确持久化个人移除，防止静默成功

`web/src/components/ChatWindow.jsx:411` 保留现有发送时间调度，不更改所有消息生命周期。使用既有DELETE `{forMe:true}`；沿用原有本地到期移出气泡及历史缓存；这不表示服务端移除已完成。服务端失败明确提示未同步、页面存活时30秒重试，成功后才结束重试；账号世代、会话与挂载状态三重检查防旧账号回调修改新页面。关闭页面后不保证后台重试；个人墓碑尚未成功落库时，其他端/接口及旧会话摘要仍可能取回正文。客户端时钟与服务器自动截止问题仍保留，不能用当前气泡隐藏声称服务器已拒绝访问。

`PrivateChatSettings.jsx` 读取服务器归一化值；Android/iOS设置成功再刷新真值，不再错误提前宣告“已开启”。服务器沿既有social_state_changed通知同账号其他端重拉设置（conversations.controller.js）。没有新建同步协议。

### 4.2 服务端：个人移除后从实际读取入口隔离正文

新增 `backend-v2/src/modules/messages/visibility.js:6`：当前成员资格 + deleted=0 + 个人删除墓碑 + 会话清空水位。复用现有数据，不缓存授权结论。

| 链路 | 本轮处理 | 主要代码 |
|---|---|---|
| 历史/离线missed/around/导出 | 不回传个人已移除内容；引用投影重新授权 | messages.service.js:125、192、947、1001、1021 |
| 搜索/热缓存 | 缓存命中后复查每条权限；失效失败也不能返回被移除正文 | messages.service.js:752、896 |
| 旧事件补拉 | created/edited按当前授权投影；个人无权事件转已有message_deleted_for_me，payload空，游标继续推进 | sync.service.js:89 |
| 实时消息/编辑/批量队列 | 发送前按当前接收者投影，引用不沿用无权正文；重复ACK返回空墓碑 | realtime/broadcaster.js；handlers/message.js；visibility.js:28 |
| 引用/转发/群置顶 | 校验转发/新增收藏源消息当前可读（收藏仅隔离测试启用，线上开关不改）；置顶列表不泄露个人删除内容；全局撤回保留旧端所需空引用墓碑 | messages.service.js:235、274、337、649；groups.service.js |
| 会话摘要/未读/@/文件媒体列表 | 保持原lastMessage个人删除过滤，补未读/@计数及媒体/附件列表过滤 | conversations.service.js:227、238、259、561；messages.service.js:1166、1177、1219 |

个人墓碑写入使用INSERT OR IGNORE；同账号所有设备收到既有message_deleted_for_me。普通消息和仍合法的其他成员/其他会话引用保持可用。没有为“同步”继续向无权用户携带正文。

### 4.3 清除已有全局删除的编辑事件残文（不冒充自动清理）

原有合法vanish/撤回/管理员撤回事务除清messages正文与file_url外，同事务清 `conversation_events.payload`。证据：messages.service.js:459、494、548、582。老事件游标、消息ID、既有deleted语义保留。重复全局删除幂等。

这是**新发生的合法删除请求（含批量撤回）**的内容清理，不是按阅后即焚自动期限扫描历史。批量撤回也使用同一事务清理编辑事件payload；已deleted=2的历史行早退路径不会自动补清旧残文；历史数据只能按另附隔离清理方案处理。本轮没有触碰生产历史。

### 4.4 附件与通知

`backend-v2/src/app.js:177`：先验证可信file_registry/分享登记，再要求当前用户在原始或登记分享会话中仍有可读消息引用。个人删除后此前签发的应用下载ticket使用时也重新鉴权；另一合法分享消息仍可访问，避免误删共享资源。图片/缩略图按原baseId规则匹配；不能通过伪造另一条message.file_url扩大授权。

`cdnOptimizer.js`：聊天files不重写为公开CDN URL；不能覆盖私有no-store为public immutable。`messages.routes.js`和附件响应使用private,no-store。**不声称旧CDN/对象存储链接已经失效**。

`utils/push.js:276` 发推前重查messageId当前授权；burn_after>0的收件人只收通用提示，不携正文（286）。测试第三方传输用mock，未给真实设备推送。

### 4.5 Android/iOS：先确认隐私策略再恢复历史缓存

Android `ChatViewModel.kt:171、490、880、894`，iOS `ChatViewModel.swift:109、342、877、889`：cachePolicyKnown初始false；不知道当前服务器策略时不把历史缓存放回页面，也不保存新历史；策略确认burn>0则清本会话缓存，普通会话允许恢复。账号世代/请求序号屏障防旧策略覆盖新账号或新失效通知。再次收到社交失效先将策略标为未知再重拉。

限制：这是历史消息缓存，不包括完整图片解码缓存、播放器缓存、系统相册、用户另存文件。联网取不到策略时保守不恢复历史缓存，会降低离线首屏可用性；没有把它写成离线阅后即焚已完整实现。

## 5. 到期访问和清理分别验收

| 用户要求的回归项 | 本次真实证据 | 结论与边界 |
|---|---|---|
| 1 到期前正常读取 | 合法删除前可读；普通消息/附件正常 | 个人删除语义PASS；服务器期限不存在，不能宣称到期前后时间边界已验 |
| 2 到期后所有实际接口拒绝正文 | 个人墓碑落库后历史、missed、sync、around、搜索、导出、引用、置顶、@、附件均拒绝 | **个人移除后PASS；自动到期BLOCKED** |
| 3 清理暂停/延迟仍拒绝 | 墓碑后无清理worker也拒绝；强制热搜索缓存仍有旧正文也不返回 | 不依赖内容清理的个人权限PASS；没有服务器到期判定 |
| 4 清理失败后重试 | SQLite触发器模拟个人墓碑写入失败，移除故障后重试成功 | 个人写入重试PASS；自动内容清理任务未实现/未测试 |
| 5 服务重启 | 新子进程读取同一隔离库仍拒绝墓碑内容 | 已持久化个人拒绝PASS；重启前未形成墓碑的过期正文仍可能可读 |
| 6 重复/乱序事件 | 重复删除、旧created/edited补拉、批量队列/实时编辑、重复ACK无正文 | 服务端投影PASS；不能保证所有已发布离线端清旧副本 |
| 7 离线重连 | 实际sync重新投影；Web/Windows备注重连实测 | 已落库墓碑不会在服务端补回；没有设备阅读时的自动到期仍未实现 |
| 8 引用/摘要/通知/搜索 | 专项API+Socket、推送mock、摘要/计数查询检查 | 覆盖的新请求PASS；独立复制文本/转发保留规则待决策 |
| 9 附件与缓存 | 原票据403、合法分享保留、PNG no-store、原生延迟策略缓存测试 | 应用代理/历史缓存已覆盖；旧云链接/媒体全部缓存未完成 |
| 10 普通消息 | 后端最终全量928通过，Web268通过；合法访问专项 | PASS于已执行范围 |
| 11 不误删其他人/合法引用 | 另一账号仍读原文；同资源合法转发会话仍可下载 | PASS；没有批量资源清理 |
| 12 旧端兼容 | 真实发布Web4项基本兼容；burn负例仍403且可读 | 基本协议兼容PASS；旧burn能力FAIL/需升级，另三端旧二进制未运行 |

时间口径：本地气泡隐藏可能早于个人删除ACK；只有个人删除ACK代表持久化拒绝已完成；没有独立expires_at、cleanup_completed_at或自动销毁完成时间。不能声称访问截止和清理完成为同一时刻。

## 6. 本次实际测试、原生与Windows验证

当前机器先找到已有Android SDK34/build-tools34和JDK17，复用项目配置，不升级依赖。默认JDK21缺jlink的失败保留记录，切JDK17后完整build/test成功。iOS复用macOS15/Xcode16 GitHub runner；Windows复用Windows runner，源码构建和实际Electron运行与安装包签名分开。

| 平台/层级 | 本次结果 | 证据/实际范围 |
|---|---|---|
| 后端全量 | **928 PASS / 0 FAIL / 1既有SKIP** | evidence/backend-complete.json（最终a5b1d72e源码）；CI 35493978303覆盖率门禁属于67bc0ef9阶段926项通过，不替代最后两处后端修补的本地全量结果；原有performance排除、测试关闭限流的跳过不算生产验收 |
| 后端P0/同步/兼容专项 | **52 PASS** | evidence/backend-complete.json中本轮5个专项文件；p0-complete-focused.json；真实Express/SQLite/Socket.IO，合成账号 |
| Web逻辑 | **268 PASS**；lint 0 warning；构建PASS | evidence/web-outage-tests.json、web-outage-lint.log、web-outage-build.log |
| 新Web浏览器 | **10项PASS** | evidence/browser-current/browser-core.json；真实本地服务端，禁止外部请求 |
| Windows源码/应用 | **10项真实Electron交互 + 17项壳测试PASS** | Windows CI 35493978303；evidence/windows-native-final/browser-core.json；win32/Electron43.7.0/packaged=false |
| Linux Electron补充 | 9项PASS | tmp/electron-local-final/evidence/browser-core.json；不替代Windows |
| Android本地构建/JVM | **100测试PASS**；debug APK及instrumentation APK构建成功 | evidence/android-current-build.log与Gradle XML；不是Android应用验收的替代 |
| Android模拟器 | **模拟器3/3 PASS**（CI 35493170303） | API34 x86_64，3个真实Compose/存储/VM用例；使用隔离HTTP夹具，不是真实双设备网络 |
| iOS构建/模拟器 | **构建PASS，模拟器24/24 PASS；旧缓存反例复现成功**（CI 35493434948） | macOS runner；24项定向XCTest及旧缓存反例，未执行整轮样式审计 |
| 真机 | **NOT_RUN** | 无本轮真实Android/iPhone/物理Windows设备证据 |
| Windows正式安装包/签名 | **NOT_RUN/BLOCKED** | 上轮缺UPDATE_PRIVATE_KEY签名前置；未调用发布打包脚本，未绕过门禁；不阻断源码运行验证 |
| 旧发布Web+新Server | 4项基本兼容PASS，burn负例确认FAIL | evidence/legacy-browser-core.json、legacy-web-identity.json |

Windows隔离HTTP环境的钱包免密码快速切换返回400；本轮用正常密码切换路径验证A/B/A。该限制在结果JSON中明确保留；不能把密码回退的PASS写成免密快速切换通过。

新增异常路径红绿：c6fe44f9产物在持续503时气泡未隐藏（tmp/browser-outage-red/evidence/browser-core.json）；67bc0ef9产物保留本地到期隐藏、明确显示未同步，服务恢复后30秒重试形成个人墓碑并拒绝读取，10项浏览器流程通过。首次夹具只拒绝单次请求被Axios自动重试恢复，不计产品失败；随后使用持续故障直至观察到提示。

红绿记录：审计基线新增访问测试10项中8失败/2通过；推送预览反例1失败；@列表遗漏1失败；该阶段专项50通过；末次两条反例（收藏/批量撤回）修补前16通过/2失败，修补后专项52通过。原先全量中“撤回引用墓碑”兼容断言失败已按旧契约修正，并重跑全部926。CI中的Android占位符断言、缺rg工具，iOS把Token轮换误作账号切换/等待被新请求替换，均为测试问题；保留失败日志，不当成新的产品issue。

SOCIAL-001新增：Web与Windows真实A→B空输入→A恢复→重载；Android真实Compose输入框/SessionManager/DraftStore；iOS实际ChatViewModel/Keychain identity/DraftStore；旧账号迟到写入屏障单测。仍未完成四端真机后台/进程重启/快速连续钱包切换及全部回复/附件状态验收，不整项关闭。

SOCIAL-008新增：Windows真实HTTP另一会话修改备注、Socket推送、断线重连、免打扰打开页面更新/写回、资料拉黑失效；Android真实ContactsUI重拉、iOS实际ContactsVM重拉，原生事件采用测试入口注入、HTTP夹具。后端双Socket/失败不广播/关系变更及读取屏障回归通过。原生真实双连接、全资料/黑名单/免打扰页面组合和推送设备未完成，不用Web覆盖替代。

四端旧版本：Web8.1.24实际运行；Windows8.1.29、Android8.1.26(83)、iOS8.1.25(1789842617)仅发布基线/协议代码审查，**本轮没有运行这些旧二进制**。新API形状保留，复用个人删除/墓碑事件，旧端未知social_state_changed可忽略后刷新；旧端不会因服务器升级而自动清掉已存本地数据。当前没有可声称通过全部burn隐私验收的新最低版本，不能捏造一个升级版本号。

## 7. 附件、日志、备份及历史处理边界

| 存储/副本 | 当前控制与剩余限制 |
|---|---|
| 主库 | 个人墓碑保留其他合法用户正文；合法全局删除清content/file_url；无自动到期物理销毁 |
| FTS/事件/缓存 | 授权重查阻断旧缓存回传；现有FTS触发器随全局删除更新；新单条/批量全局删除清编辑payload；非物理安全擦除SQLite页/WAL |
| 应用下载链接 | 每次访问重查当前授权，已签发应用ticket亦然；资源尚有本人合法分享引用时继续允许 |
| 对象存储/CDN | 既有云302签名有效期600秒，已发链接不能立即撤销；之前公开CDN缓存、对象桶实际公开策略未核实；本轮停止新增聊天CDN直链不等于旧链接失效 |
| 原文件/缩略图 | 未物理删除；同一文件合法多处引用必须保留；媒体下载/缩略图访问复用鉴权，单独音视频播放器全链路未设备实测 |
| 本地历史 | 新原生先校验策略再读写；Web个人删除成功清该消息；旧客户端、系统缓存和离线未升级设备不能远程保证彻底删除 |
| 用户主动保存 | 截图、系统相册、下载、手动复制完全不能承诺远程擦除 |
| 推送 | 新启用burn的预览不带正文；旧推送、第三方保留、系统通知截图无法撤回 |
| 日志 | 本轮合成日志不含真实私信/有效凭据；requestLogger不记录请求body，但query.q不在脱敏键中，用户搜索文本可能留日志（logger.js:79、104，CODE_ONLY）；没扫描生产日志，未证实真实正文留存情况；未来清理失败只应记录ID/阶段/错误码，不记录正文 |
| 备份 | deploy/touliao-backup.sh:23默认30天、55/77备份SQLite及uploads；这是源码默认值，非已核实线上计划；无自动到期恢复门禁，早期备份可复活旧数据 |

`historical-cleanup-plan.md` 及 `evidence/historical-cleanup-rehearsal.json`（5项合成SQLite方案检查通过，不是产品worker）提供离线副本演练、当前已删除事件残文的最小幂等处理与恢复隔离规则。任何恢复到旧快照的服务必须先保持外部访问关闭，补回最新个人墓碑/撤权并执行已批准的期限策略后才能开放。若没有比快照更新的墓碑记录或可信期限，不能保证恢复不复活内容；不能只靠恢复后后台慢慢清理。本轮未执行生产备份/日志/数据库删除或迁移。

## 8. 原23项逐项状态

| ID | 原功能 | 优先级 | 开发状态 | 本轮说明 |
|---|---|---|---|---|
| SOCIAL-001 | 会话草稿缺少账号隔离 | P0 | IMPLEMENTED_VALIDATION_PENDING | 增加Windows真实Electron、Android/iOS原生集成验证；快速钱包切换、完整原生重启/后台/真机矩阵仍未齐，保持验收待补。 |
| SOCIAL-002 | 群成员接口绕过资料可见设置 | P0 | DEV_VERIFIED | 服务器根因本轮隔离验收通过；未发布，原生提示待设备验证。 |
| SOCIAL-003 | 直接拉群未覆盖双方拉黑关系 | P1 | DEV_VERIFIED | 服务器根因本轮隔离验收通过；未发布，原生提示待设备验证。 |
| SOCIAL-004 | 通话与消息的关系门控不一致 | P1 | DEV_VERIFIED | 服务器根因本轮隔离验收通过；未发布，原生提示待设备验证。 |
| SOCIAL-005 | “禁止成员间私聊”只有配置与客户端限制 | P1 | BLOCKED_PRODUCT_DECISION | 群来源、好友与多个共同群的规则未定义，不扩大限制。 |
| SOCIAL-006 | 群邀请缺少撤销与被踢后重入规则 | P1 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-007 | 接受好友申请时未复查申请者账号状态 | P1 | DEV_VERIFIED | 服务器根因本轮隔离验收通过；未发布，原生提示待设备验证。 |
| SOCIAL-008 | 关系、资料和会话偏好缺少跨设备失效通知 | P2 | IMPLEMENTED_VALIDATION_PENDING | 增加Windows实时/重连与原生联系人失效集成验证；原生双设备真实Socket及全部偏好/资料页面矩阵未齐，保持验收待补。 |
| SOCIAL-009 | 群通话未随踢人收回参与权限 | P0 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-010 | 朋友圈通知未按当前可见性重新授权 | P0 | DEV_VERIFIED | 服务器根因本轮隔离验收通过；未发布，原生提示待设备验证。 |
| SOCIAL-011 | 阅后即焚未形成可靠销毁链路 | P0 | PARTIAL_RULE_BLOCKED | 已修个人移除后的访问绕过、事件正文残留、通知预览及原生缓存竞态；服务器自动到期与全局清理规则未定义，P0不关闭。 |
| SOCIAL-012 | 原生缺群成员资料入口及名片操作闭环 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-013 | 原生缺成员邀请权限管理和成员搜索入口 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-014 | 原生未接入动态编辑 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-015 | 原生好友申请推送缺少正确点击目标 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-016 | 缺少用户、聊天消息和群举报链路 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-017 | 好友申请缺撤销和过期终态 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-018 | 动态编辑绕过创建时内容审核 | P1 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-019 | 移动端被叫缺协商阶段超时收敛 | P1 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-020 | 撤回后的消息仍可新增Reaction | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-021 | iOS删除好友提示错误承诺删除聊天记录 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-022 | 统一社交通知中心尚未形成用户功能 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |
| SOCIAL-023 | 外部邀请链接缺原生接续，Web预览自动入群 | P2 | OPEN_OUT_OF_SCOPE | 保留未关闭，不扩展本轮开发。 |

005继续规则待确认：不自行禁止既有好友正常沟通；009群通话踢人撤权、019通话超时、006/023邀请、016举报、012原生资料名片、022通知中心等均保持未关闭。功能开关关闭不取消风险登记。

## 9. 停止条件、后续最小方案和生产声明

本轮能够独立证实的访问/缓存修补已经完成开发及适用验证；未扩展18项问题。P0下一步依赖第3节四个产品定义，之后最小方案为：兼容的服务器期限及接收者作用域记录→所有读取出口共享可信期限投影→无正文墓碑同步→独立可重试清理/附件引用检查→恢复时先执行拒绝访问门禁→新旧端滚动验收。此方案本轮未实现、未迁移、未发布。

若后续只读运维证据确认生产正在启用有缺口的burn功能，应立即告知实际受影响版本和会话范围，提出暂停新启用/明确限制的最小运维处置评审；不能未经授权改生产开关或批量清历史。本轮Server加载SHA和具体启用范围UNKNOWN，未把开发分支风险写成已确认线上事件。

**修改产品代码：是，仅独立开发分支。修改生产环境/数据库/配置：否。发布/部署/TestFlight/更新指针：否。** GitHub仅触发隔离构建与测试，未触发生产工作流；没有购买CI服务，没有真实客户测试消息。

## 10. 可点击源码证据

- 服务器现有设置归属：[backend-v2/src/modules/conversations/conversations.service.js:468](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/modules/conversations/conversations.service.js:468)
- 个人/全局删除权限：[backend-v2/src/modules/messages/messages.service.js:474](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/modules/messages/messages.service.js:474)
- 全局删除事件残文清理：[backend-v2/src/modules/messages/messages.service.js:459](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/modules/messages/messages.service.js:459)
- 当前访问投影：[backend-v2/src/modules/messages/visibility.js:6](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/modules/messages/visibility.js:6)
- 旧事件重新授权：[backend-v2/src/modules/messages/sync.service.js:89](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/modules/messages/sync.service.js:89)
- 附件可信来源与当前引用：[backend-v2/src/app.js:182](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/app.js:182)
- 聊天CDN旁路防护：[backend-v2/src/integrations/cdnOptimizer.js:37](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/integrations/cdnOptimizer.js:37)
- 通知当前授权：[backend-v2/src/utils/push.js:276](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/utils/push.js:276)
- Web定时个人移除：[web/src/components/ChatWindow.jsx:411](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/web/src/components/ChatWindow.jsx:411)
- Android缓存策略：[android/app/src/main/java/com/touliao/app/feature/chat/ChatViewModel.kt:171](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/android/app/src/main/java/com/touliao/app/feature/chat/ChatViewModel.kt:171)
- iOS缓存策略：[ios/Touliao/Features/Chat/ChatViewModel.swift:109](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/ios/Touliao/Features/Chat/ChatViewModel.swift:109)
- 既有本地缓存契约：[docs/offline-message-cache-contract.md:67](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/docs/offline-message-cache-contract.md:67)
- 既有备份默认范围：[deploy/touliao-backup.sh:23](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/deploy/touliao-backup.sh:23)
- 后端读取回归：[backend-v2/test/burn-access-regression.test.js:16](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/test/burn-access-regression.test.js:16)
- Android应用集成测试：[android/app/src/androidTest/java/com/touliao/app/review/NativeUIReviewTest.kt:94](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/android/app/src/androidTest/java/com/touliao/app/review/NativeUIReviewTest.kt:94)
- iOS应用VM集成测试：[ios/TouliaoTests/Review/NativeUIReviewTests.swift:123](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/ios/TouliaoTests/Review/NativeUIReviewTests.swift:123)
- Windows/Web真实运行工具：[scripts/social-core/runtime.cjs:2](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/scripts/social-core/runtime.cjs:2)
- 新增收藏源鉴权：[backend-v2/src/modules/messages/messages.service.js:649](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/modules/messages/messages.service.js:649)
- 批量撤回事件清理：[backend-v2/src/modules/messages/messages.service.js:435](/home/ubuntu/touliao-social-p0-remediation-20260920/worktree/backend-v2/src/modules/messages/messages.service.js:435)

验证提交对应关系见 `evidence/tested-source-identity.json`：iOS测试提交c6fe44f9之后没有ios/源代码变化；Android测试提交a41be979之后没有android/变化；后端最终a5b1d72e新增收藏源鉴权及批量撤回清事件；最终本地全量测试单独记录，不能用67bc0ef9的CI结果替代最后两处后端修补。最终Web/Windows修补为67bc0ef9；报告提交仅包含文档和脱敏摘要。

iOS红绿证据：`evidence/ios-native-final/social-cache-baseline.log:5854`为旧ChatViewModel同步恢复缓存的失败断言；`xcodebuild-test.log:2389、2394、2397、2415`记录001/008/011新集成用例及24项全通过。没有把旧代码的预期失败计入当前失败数。

最终CI证据：[四端门禁（67bc0ef9）](https://github.com/zhaocaimao008/touliao/actions/runs/35493978303)、[iOS红绿与24项模拟器测试（c6fe44f9，iOS源码至最终未变）](https://github.com/zhaocaimao008/touliao/actions/runs/35493434948)。最终后端a5b1d72e以本地完整回归及新旧Web重跑验证，未将较早CI冒充最终后端验证。
