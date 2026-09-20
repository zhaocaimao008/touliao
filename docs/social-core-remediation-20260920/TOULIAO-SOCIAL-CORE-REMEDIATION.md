# 投聊第一阶段社交核心整改

日期：2026-09-20 UTC。目录：/home/ubuntu/touliao-social-core-remediation-20260920/。

来源：/home/ubuntu/touliao-social-audit-20260920T013600Z/ 的五个真实审计文件。原审计共23项，沿用原ID；没有把未实现的新功能混入整改。

## 1. 结论与关闭口径

本轮为 **7项原问题完成开发分支修复**：SOCIAL-001/002/003/004/007/008/010。SOCIAL-005因产品规则不明保留阻断。

严格验收口径：**5项服务端根因在开发分支验收关闭**（002/003/004/007/010）；**18项仍未关闭**＝15项本轮范围外＋005产品决策阻断＋001/008已改代码但原生及Windows应用验收未齐。这里的关闭不代表已经发布，也不代表四端整包均通过；原生新增反馈仍需构建和设备验证。生产修复关闭数为 **0**。

| 最终问题 | 回答 |
|---|---|
| 草稿跨账号是否解决 | 四端业务代码已隔离；Web真实浏览器通过，Windows共享代码/壳测试通过，Android纯JVM逻辑通过；Windows应用、Android完整应用、iOS仍待验收，001不宣称全平台关闭。 |
| 无权用户还能从接口读隐藏资料吗 | 本轮本人、好友、陌生共同群成员、双向拉黑、删除关系测试中不能；授权者仍可读。新Web已打开的资料页会撤下失效签名。结论针对新服务端，不推定现网已修。 |
| 拉黑覆盖邀请与呼叫吗 | 已覆盖直接建群选人、后续直接邀请、一对一请求/应答/信令/恢复；已有呼叫在相关关系修改后撤权。邀请链接的撤销/重入和群通话不在关闭范围。 |
| 群私聊限制是否服务端执行 | 005未关闭。非好友创建私聊与双向黑名单已有服务端门控；不能据此声称no_private_chat已完整执行。既有好友保持合法沟通。 |
| 多端更新是否补齐 | 失效事件、四端重拉、重连对账和过期响应屏障已写入；真实双Socket及Web浏览器通过；原生集成待验收，008不关闭。 |
| 本轮关闭哪些原问题 | 002、003、004、007、010，仅开发分支服务端根因验收。 |
| 全部还剩多少 | 严格验收口径18项；其中001/008已改，005待规则，其余15项保留。 |
| 下一轮风险 | 优先011阅后即焚正文保留、009群通话踢人撤权、019协商超时；补001/008原生验收和005规则。 |
| 生产环境是否修改 | 否。仅读版本、健康和进程身份；测试写入本轮隔离库。 |
| 是否发布 | 否。无部署、推送分支、发布、自动更新修改或生产迁移。 |

完整状态表：[remediation-status.csv](/home/ubuntu/touliao-social-core-remediation-20260920/remediation-status.csv)。完整修改文件：[changed-files.csv](/home/ubuntu/touliao-social-core-remediation-20260920/changed-files.csv)。

## 2. 基线、版本与工作区保护

独立分支：fix/social-core-20260920；独立worktree：本目录/worktree。

基线：d376c6a275b3af65a3edaae62d007a327c35b54f；检查点：checkpoint/social-core-20260920-baseline；范围检查点提交589934c1。

主修复提交：f64b99477672eb5f851e04b5da829fd43726c888；最终代码提交：867bc60a08e49a4cee694dcdde8614a6b969eab6。

基线继承最近已验证的四端d93a861与Windows08c67345成果，未退回旧UI分支，未混入其他开发分支的新功能。

| 平台 | 本轮只读核实版本 | 对应源码和证据 | 本轮待发布内容 |
|---|---|---|---|
| Windows | 8.1.29 | 发布链映射08c6734506a7b9766995979aff4c566dae64bc67；基线包含后续d376检查成果 | 新共享Web业务逻辑；未打包发布 |
| Android | 8.1.26(83) | d93a861b617b200973c3ecc9314105faac921402，版本JSON与发布记录一致 | 新原生业务逻辑；完整构建受SDK阻断 |
| Web | 8.1.24 | d93a861；线上入口SHA256与发布清单一致 | 本轮本地构建完成；未替换线上资源 |
| iOS TestFlight | 8.1.25(1789842617) | d93发布记录；本轮ASC返回VALID、external IN_BETA_TESTING | 新原生业务逻辑；无Xcode构建 |
| Server | **实际加载SHA仍未核实** | PID730353；cwd为gh-mirror/touliao/backend-v2；磁盘仓库HEAD45dccd99不能当作内存SHA；/health无commit | 本轮服务端修复仅在开发分支 |

证据：[live-baseline.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/live-baseline.json)、[ios-live-baseline.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/ios-live-baseline.json)、[server-baseline.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/server-baseline.json)。上一轮“140个backend磁盘文件与d93一致”仅为历史源码比对，不替代进程构建身份。

线上moments、collect、groupVoiceCall、groupVideoCall均false，voiceCall/videoCall为true。本轮未修改功能开关。收尾再次只读核对Windows、Android、Web、发布清单、health和config，均与开工快照一致：[live-after-readonly.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/live-after-readonly.json)。动态修复只在隔离环境验证，没有上线验收结论。

18个既有worktree的HEAD、状态和原有12个未提交文件哈希均保持不变：[worktree-protection-final.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/worktree-protection-final.json)。未执行reset/clean，未提交他人修改。依赖独立复制到本轮目录，没有升级依赖。

## 3. 先建整改表，再按原问题执行

初始范围表已经先提交：[intake.md](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/docs/social-core-remediation-20260920/intake.md)。

| 原ID | 修改前证据/复现 | 平台 | 实际修复范围 | 验收 |
|---|---|---|---|---|
| 001 | 仅conversationId草稿键；旧账号页面等异步结束才消失 | 四端 | 环境+账号+会话键、身份世代、切号销毁页面、旧键隔离 | Web模块/浏览器；Android JVM；原生整包及Windows待验收 |
| 002 | 隐藏bio在个人详情为空，群接口仍返回 | Server/四端 | 按查看者统一投影敏感字段、缓存失效 | 真实service+SQLite、HTTP、新Web页面通过 |
| 003 | 任一方向拉黑仍能直接拉群 | Server/四端 | 建群/邀请统一规则，去重，读取已有结果计数 | 双向拒绝、合法部分成功、重复邀请通过；原生反馈CODE_ONLY |
| 004 | 主叫拉黑、拒陌生消息、接听前关系变化门控遗漏 | Server/四端 | 请求、接受、信令、恢复重查，变更撤权 | 真Socket.IO+HTTP、既有信令回归；原生媒体未验收 |
| 005 | no_private_chat持久化/客户端限制存在，服务端范围不明 | 四端/Server | 保留已明确基本门控，不扩大好友限制 | 限制群好友允许、陌生人创建拒绝通过；规则阻断 |
| 007 | 申请者被禁用后旧申请仍可通过 | Server/四端 | 接受前查账号，保留拒绝幂等及黑名单 | 禁用/拉黑拒绝，无半边写入；正常接受通过 |
| 008 | 写库和本地更新有，其他设备不更新 | 四端/Server | 无值失效事件、GET真值、账号/请求屏障、重连对账 | 双连接与Web实时/离线通过；原生待验收 |
| 010 | 通知返回当前无权动态正文/评论/缩略图 | Server/四端 | 生成/读取授权、分页前过滤、计数一致、撤下缓存 | 私密/删好友/拉黑/天数/排除及合法返回通过；线上仍关闭 |

## 4. 逐项实现与证据

### SOCIAL-001：草稿账号隔离

持久化身份是环境地址、账号ID、会话ID；运行时再要求同一身份世代和页面捕获的owner。Web用JSON数组编码，Android/iOS用长度编码避免分隔符碰撞。正常凭据轮换不改变草稿归属；切号、退出、切环境使旧owner失效。页面按身份重建，回复、引用、附件选择等非持久化状态随页面销毁，没有新增附件草稿云同步。

Web初次挂载也恢复草稿，切换期间沿用loading路由先清旧用户。iOS输入即时按捕获owner持久化，消除原300ms延迟窗口；迟到回调仍拒绝。原生先读凭据锁再取草稿锁，避免反向锁序。

**旧格式策略：隔离保留，不自动导入，不猜所有者。** 未删除所有用户聊天记录。旧无主草稿不分配给首次登录用户；新格式已知账号草稿可恢复。不能保证降级到旧客户端后仍安全处理旧键。

主要代码：

- [Web草稿存储](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/web/src/utils/draftStore.js:1)、[ChatWindow捕获owner](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/web/src/components/ChatWindow.jsx:272)、[账号页面重建](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/web/src/App.jsx:39)、AuthContext。
- [Android DraftStore](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/android/app/src/main/java/com/touliao/app/core/storage/DraftStore.kt:1)、[SessionManager](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/android/app/src/main/java/com/touliao/app/core/auth/SessionManager.kt:50)、[AppNavigation](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/android/app/src/main/java/com/touliao/app/navigation/AppNavigation.kt:177)、ChatViewModel。
- [iOS DraftStore](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/ios/Touliao/Core/Storage/DraftStore.swift:1)、[SessionStore](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/ios/Touliao/Core/Session/SessionStore.swift:36)、[RootView](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/ios/Touliao/App/RootView.swift:30)、ChatViewModel。

实际步骤：A写同群草稿→添加/切B为空→B写自己的草稿→切A恢复A→刷新仍恢复A。模块另测共同群/私聊、迟到保存、ABA、换环境、退出、重建存储实例、正常凭据轮换。

证据：[browser-core.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/browser-core.json)、[合成B账号截图](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/browser-b-isolated.png)、[web-final.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/web-final.json)、[Android JVM结果](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/android-jvm-logic.log)。Android使用实际DraftStore源码和存储夹具，**不是模拟器/真机**；iOS XCTest已提交但未运行。

仍待Windows应用多窗口、Android/iOS快速切号/后台恢复/冷启动及附件/引用状态设备验收，001不关闭。

### SOCIAL-002：资料与预览权限

服务器每次读均按当前查看者判权；共享缓存只保存基础资料，不缓存授权结论。本人保留字段；非本人需无双方黑名单，且资料公开或为现有好友。群成员身份不额外授予隐藏签名。联系人和群info共用投影，保留合法name/avatar/id/role/nickname；无权bio/cover为空、last_online_at不输出。搜索/二维码预览原本只返回公开白名单字段，已验证且未扩大输出。

资料、联系人、会话和群info增加private,no-store。新客户端收到失效先清隐私投影再重拉，不合并过期GET。不能收回他人已下载、截图或旧客户端离线保存的副本。

代码：[socialPrivacy.js:6](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/utils/socialPrivacy.js:6)、[users.service.js:225](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/users/users.service.js:225)、[groups.service.js:265](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/groups/groups.service.js:265)、UserProfile/GroupInfo/原生群成员与联系人刷新。

用例：[social-core-permissions.test.js:26](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/test/social-core-permissions.test.js:26)。覆盖本人、好友、陌生共同群成员、拉黑、热缓存删好友。浏览器先展示合法签名，另一端拉黑后撤下，同时直接HTTP profile/group-info均返回空bio：[browser-core.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/browser-core.json)、[资料撤权截图](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/browser-profile-redacted.png)。

002服务器根因通过。媒体原文件、CDN、备份清除不在字段投影关闭声明内。

### SOCIAL-003 / SOCIAL-007：邀请与申请

建群和后续直接邀请共同检查真实好友、目标账号可用、允许直接邀请、双方未拉黑。名单先去重，INSERT OR IGNORE保证重复邀请不产生重复成员。保留原有部分成功行为，后续invite保留added/blocked数字响应；不暴露具体哪方拉黑。

Web三语提示改为关系/账号/邀请设置限制，不再错误建议用二维码绕过。Android/iOS解析服务器已有计数，不再把全部受阻的200响应视为邀请成功；iOS增加本流程的结果提示。建群仍沿用conversationId/groupNumber响应并以实际成员名单为准，没有新增逐人拒绝原因字段。没有重设计页面或图标。

接受申请前复查申请者存在/未banned，接收者由认证入口检查；原有归属、请求状态、黑名单继续执行。失败不写联系人；未新增申请撤销、过期机制。

代码：[directInvitees](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/utils/socialPrivacy.js:33)、[createGroup](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/conversations/conversations.service.js:93)、[invite](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/groups/groups.service.js:170)、[handleRequest](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/contacts/contacts.service.js:156)。原生修改为GroupApi/Group模型、GroupRepository、InviteMembersViewModel/View，见完整文件清单。

用例：[social-core-permissions.test.js:54](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/test/social-core-permissions.test.js:54)。两个黑名单方向均拒绝；允许目标保留；重复名单/请求无重复成员；禁用申请者、拉黑后接受拒绝，解除限制正常接受；拒绝重复操作保持既有幂等。003/007服务端根因关闭，原生结果提示为CODE_ONLY待构建。

### SOCIAL-004：一对一呼叫门控

沿用现有消息接收规则：双向拉黑拒绝，任一账号不存在/禁用拒绝，被叫block_unknown_messages开启且没有主叫联系人则拒绝；仍要求已有私聊会话。没有擅自禁止全部陌生来电；删好友后按原接收设置处理。

实际入口覆盖call:request、call:response接受、call:offer/answer/ice、call:switch-type、call:resume。信令先经已有registry验证，再按原主叫→被叫重新查关系。HTTP关系/隐私修改复核在途/接通呼叫，清timer/registry，向两账号发送既有call:end(permission_revoked)。

代码：[privateContactPolicy.js](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/utils/privateContactPolicy.js:1)、[call.js:104](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/realtime/handlers/call.js:104)、[socialState.js](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/realtime/socialState.js:1)。增量错误码CONTACT_BLOCKED / ACCOUNT_UNAVAILABLE / CONTACT_NOT_ALLOWED，仍给旧端accepted:false或call:end。新四端提示“当前关系或账号状态不允许通话”。call_logs沿用原status枚举，没有迁移。

用例：[实际信令处理器](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/test/social-core-permissions.test.js:112)、[真实Socket.IO](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/test/social-core-sync.test.js:56)、既有call-signaling-contract。双Socket发起→HTTP拉黑→对端同callId结束→旧请求形状再拨被拒。接听前关系变化、缺失账号拒绝自动验证；各offer/answer/ICE入口复用检查由代码审查和既有信令回归覆盖，未伪装成真人音视频验证。009群通话撤权、019协商超时未改。

### SOCIAL-005：规则阻断，不扩大限制

现有文档和“禁止成员间私聊”文案未定义：限制从本群关系联系陌生人、限制全部共同群成员，还是只隐藏群来源入口。不能因为两人同属限制群而封掉合法既有好友。

待决策：①仅群来源新建会话还是已有会话也受限；②已有好友豁免；③还有允许私聊的共同群时如何选来源；④删好友后的已有会话如何结合原陌生消息设置。未重建陌生人社交，不将no_private_chat等同no_add_friend。

已有getOrCreatePrivate要求好友并检查双向黑名单，消息发送保留原政策。本轮确认“限制群既有好友允许、陌生人创建拒绝”。证据：[conversations.service.js:28](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/conversations/conversations.service.js:28)、[群设置持久化](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/groups/groups.service.js:288)、[客户端入口判断](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/web/src/components/MessageItem.jsx:85)。**005仍未解决，基本门控不等于群规则完整执行。**

### SOCIAL-008：多端失效与重新对账

复用现有Socket.IO、user房间和HTTP查询，新增social_state_changed无值失效事件，内容只有scopes和定向事件的userId，无备注/签名/正文。收到后重读真值；旧/重复事件只触发重拉，不携带旧字段值去覆盖状态。关系、黑名单、备注、资料/头像/封面、用户设置、会话mute/pin/archive成功后触发；失败不广播。既有好友申请事件保留。

公开资料可能在无关系陌生人设备上打开，因此资料/隐私变化发送不含主体ID和值的全局失效；相关服务器会话缓存按联系人/共同群受众清理。代价是额外GET扇出；本轮未创建独立事件日志或第二套同步系统，后续可按性能证据细化订阅。

Web用账号世代和本地失效修订号丢弃旧GET；原生SocialReadGuard再加请求序号。重连执行当前GET，不补放历史值。页面身份重建、连接凭据/owner检查防串号。备注和免打扰写成功也重拉，避免迟到POST完成回调覆盖其他端新值；Android失败回滚检查身份与修订。

代码：[服务端事件](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/realtime/socialState.js:1)、[Web修订屏障](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/web/src/utils/socialState.js:1)、axiosInterceptor、useConvSettings、四端Socket与联系人/资料/群info/设置/会话列表；[Android guard](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/android/app/src/main/java/com/touliao/app/core/realtime/SocialReadGuard.kt:1)、[iOS guard](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/ios/Touliao/Core/Realtime/SocialReadGuard.swift:1)。

实际验证：两个真实Socket同时收备注失效；离线后GET为新值；资料/删关系/mute触达；404失败不广播。新Web另一会话HTTP改备注后界面更新，离线重连恢复；另一会话改免打扰后已打开设置立即更新，界面再次关闭免打扰后直接GET确认已保存。模块覆盖重复/迟到事件、过期GET、ABA，迟到mute/pin响应不能覆盖新状态。原生集成和Windows多窗口仍待验收，008不关闭。

### SOCIAL-010：动态通知当前授权

生成通知前校验收件人当前能看原动态、与互动者无拉黑；现有推送不携带正文预览。读取在SQL分页前过滤作者关系、private/include/exclude、可见天数、作者/互动者双向黑名单、已删除对象。items、total、unread-count共用谓词；无权条目不返回正文、缩略图或评论。

代码：[通知生成](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/moments/moments.service.js:19)、[统一查询过滤](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/moments/moments.service.js:524)、moments.controller与四端Moments清预览。权限变化/动态编辑删除发无值失效，无法清除已截取副本。

本轮自动验证friends→private、删好友、拉黑、天数、exclude后详情拒绝且items/total/unread均0；合法回复结构和重复已读通过。删除对象由JOIN/原有删除链路和既有套件覆盖，未单独做四端删除通知页面真机演练。moments线上仍关闭，018编辑审核问题保留。

## 5. 协议、数据与旧客户端兼容

**无数据库结构修改、无迁移文件、无生产迁移。** 本地草稿增加v2命名空间；旧键不猜归属。HTTP原有成功结构保留；原生开始解析已有邀请计数。call只加可选reason/code，新增social_state_changed可被旧端忽略。

新Server＋**实际已发布Web8.1.24包**：本地76个入口/资源哈希全部匹配线上d93清单：[legacy-web-identity.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/legacy-web-identity.json)。真实浏览器登录、显示会话、发送合成消息、容忍新事件后刷新、隐藏字段响应和旧call:response拒绝均通过：[legacy-browser-core.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/legacy-browser-core.json)、[旧包截图](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/legacy-browser.png)。

旧端不会自动获得新同步能力，原有刷新/重登仍可读取新权限结果；新Server不能强制擦除已经下载的旧端数据。未把Web兼容测试说成Windows/Android/iOS旧二进制运行通过，后三者仅旧协议保留和代码审查，设备滚动升级矩阵待执行。

## 6. 实际验证、历史记录与限制

测试均使用本轮隔离SQLite和合成账号；浏览器服务器仅监听127.0.0.1随机端口，禁止外部HTTP请求及Service Worker。以清空继承环境的env启动，无生产.env、真实客户或业务群。

| 级别 | 项目 | 实际结果/限制 |
|---|---|---|
| 本次AUTOMATED_ONLY | 后端完整npm test | 908通过 / 0失败 / 1跳过。仓库脚本排除performance.test.js；原有登录限流用例因测试禁限流跳过，不代表生产限流已验。 |
| 本次AUTOMATED_ONLY | 核心权限/同步/既有呼叫/房间专项 | 最终专项66/66通过，含2个账号缺失复核用例和既有群/私聊忙线契约。 |
| 本次AUTOMATED_ONLY | Web全量Vitest | 268通过 / 0失败 / 0跳过，含账号生命周期、草稿、事件/GET屏障及迟到偏好响应。 |
| 本次构建通过 | Web/Windows共享renderer | npm run build通过，不等于Windows安装包构建。 |
| 隔离浏览器END_TO_END_VERIFIED | 新Web＋新Server | 8项关键流程通过：A/B/A恢复、重载、在线/离线备注、打开的免打扰设置跨端刷新/保存及资料撤权。 |
| 隔离浏览器END_TO_END_VERIFIED | 已发布Web8.1.24＋新Server | 4项兼容检查通过，76文件身份匹配。 |
| 本次AUTOMATED_ONLY | Electron既有壳测试 | profiles/update-feedback共17/17，未修改自动更新实现/配置。 |
| 本次AUTOMATED_ONLY，JVM夹具 | Android DraftStore/SocialReadGuard实际源码 | 3/3，不是AndroidOS运行。 |
| BLOCKED | Android完整构建/单测 | 已执行./gradlew --offline --no-daemon testDebugUnitTest assembleDebug；SDK location not found，未生成可验收APK。 |
| BLOCKED | iOS构建/XCTest | xcodebuild不存在；新增XCTest未运行，无模拟器/真机。 |
| BLOCKED | Windows安装包/应用 | 真实打包前置检查因缺UPDATE_PRIVATE_KEY拒绝，未绕过签名或运行发布脚本；无Windows设备。 |
| 历史基线 | d93/d376发布及设备记录 | 仅用于正确选基线，不计入本轮新代码通过数。 |
| CODE_ONLY | 原生页面/推送、部分信令细分入口 | 已接入代码，不能用Web替代原生验收。 |

红绿证据：[core-before.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/core-before.json)核心20项中15失败/5通过；[web-draft-before.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/web-draft-before.json)旧账号页面新增3失败；[preference-race-before.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/preference-race-before.json)迟到mute/pin回调2失败；[call-account-before.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/call-account-before.json)账号缺失2失败。测试夹具中的invite响应类型、mute方法、io.emit替身及忙线夹具缺少账号记录曾修正，这些夹具错误不计作产品缺陷。iOS/完整Android无法执行红绿，限制保留。

最终证据：[backend-final.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/backend-final.json)、[web-final.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/web-final.json)、[web-build-final.log](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/web-build-final.log)、[desktop-tests.log](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/desktop-tests.log)、[android-build-test.log](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/android-build-test.log)、[ios-build.log](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/ios-build.log)、[windows-build-preflight.log](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/windows-build-preflight.log)。

浏览器工具：tools/browser-core.cjs、tools/legacy-browser-core.cjs；JVM夹具：tools/kotlin-logic-tests.py。不可将这些工具指向生产。本轮没有模拟器验证或真机验证通过项。

## 7. 未关闭清单

- **SOCIAL-001 会话草稿缺少账号隔离**：P0；开发已修改；原生和Windows应用验收未齐，严格口径不关闭。
- **SOCIAL-005 “禁止成员间私聊”只有配置与客户端限制**：P1；群来源、好友与多个共同群的规则未定义，不扩大限制。
- **SOCIAL-006 群邀请缺少撤销与被踢后重入规则**：P1；保留未关闭，不扩展本轮开发。
- **SOCIAL-008 关系、资料和会话偏好缺少跨设备失效通知**：P2；开发已修改；原生和Windows应用验收未齐，严格口径不关闭。
- **SOCIAL-009 群通话未随踢人收回参与权限**：P0；保留未关闭，不扩展本轮开发。
- **SOCIAL-011 阅后即焚未形成可靠销毁链路**：P0；本轮隔离复现正文保留，从原P1升级P0待处置；Server加载SHA和生产启用范围未核实。
- **SOCIAL-012 原生缺群成员资料入口及名片操作闭环**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-013 原生缺成员邀请权限管理和成员搜索入口**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-014 原生未接入动态编辑**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-015 原生好友申请推送缺少正确点击目标**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-016 缺少用户、聊天消息和群举报链路**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-017 好友申请缺撤销和过期终态**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-018 动态编辑绕过创建时内容审核**：P1；保留未关闭，不扩展本轮开发。
- **SOCIAL-019 移动端被叫缺协商阶段超时收敛**：P1；保留未关闭，不扩展本轮开发。
- **SOCIAL-020 撤回后的消息仍可新增Reaction**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-021 iOS删除好友提示错误承诺删除聊天记录**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-022 统一社交通知中心尚未形成用户功能**：P2；保留未关闭，不扩展本轮开发。
- **SOCIAL-023 外部邀请链接缺原生接续，Web预览自动入群**：P2；保留未关闭，不扩展本轮开发。

### SOCIAL-011：原P1升级为P0待处置

本轮隔离重现：接收者设60秒，对发送已300秒的他人消息执行vanish返回403；正文仍保留、deleted=0：[burn-risk-current.json](/home/ubuntu/touliao-social-core-remediation-20260920/evidence/burn-risk-current.json)。没有读取真实消息或清理生产历史。

实际规则：conversation_settings.burn_after为每用户、每会话设置，非零值在服务端夹为60秒至7天；Web按created_at而非已读开始计时，尝试vanish并吞掉失败后移出页面。vanish要求发送者/群管理权限，普通接收者不能清对方正文。原生主要避免本地缓存，缺可靠到期执行。界面名称“阅后即焚”、Android“已开启阅后即焚”未准确说明这些限制。

证据：[setBurnAfter](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/conversations/conversations.service.js:466)、[remove](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/backend-v2/src/modules/messages/messages.service.js:472)、[Web计时](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/web/src/components/ChatWindow.jsx:413)、[Android提示](/home/ubuntu/touliao-social-core-remediation-20260920/worktree/android/app/src/main/java/com/touliao/app/feature/chat/ChatViewModel.kt:504)。

合法vanish成功也只是消息行content/file_url置空、deleted=2和事件；**附件原文件、派生缩略图、下载副本、搜索/消息事件缓存、备份的完整清除范围未证实**。不能承诺全部副本彻底删除、无法截图或留存。

升级依据：已发布客户端可选择开启，该能力没有被朋友圈式全局开关关闭，本轮已证实代码与隔离行为不符合隐私名称。Server内存SHA和生产具体启用人数未核实，不能声称已经证实所有现网消息泄露，也不能因此隐藏高风险。

下一轮先定发送/送达/已读触发、全会话统一或本地隐藏、正文/附件/派生文件/缓存/备份保留说明。若承诺服务器到期删除，再准备expires_at、幂等任务、媒体引用处理的最小兼容开发方案；用户说明必须反映实际范围，历史数据处理另行方案。**本轮没有实施销毁、生产迁移或批量删除。**

## 8. 后续验收与停止点

1. 为001/008补Android SDK、Xcode、Windows运行环境；验证A→B→A、快速ABA、后台恢复、冷启、回复/附件状态，以及双设备关系/备注/资料/黑名单/免打扰、离线恢复、迟到请求、拒绝修改与旧客户端兼容。
2. 005先确定群来源、好友和共同其他群规则，再补服务端HTTP/信令验收，不做全局误封。
3. 011优先明确隐私契约和服务端到期链路；009/019另轮处理。006/023邀请撤销/失效/登录接续、016举报、012原生资料/名片、022通知中心等继续保留。
4. 发布前仍需取得Server真实构建SHA并验证部署组合。本文不执行部署、生产迁移、开关变更或发布。

四类目标内可实施代码整改到此停止。没有补朋友圈、收藏、群通话、通知中心等新功能，没有重新设计UI或Icon System；新增提示仅服务于本轮权限拒绝反馈。
