# 离线消息历史缓存 · 跨端契约（Web / Android / iOS）

> 状态：P0 契约 + P1 Web 参考实现落地中。Android/iOS 依本契约对齐。
> 定位：**首屏占位缓存**，非真相源。服务端永远是真相源；缓存出错最坏退化为
> 「空白等拉取」，绝不产生数据错误。

## 1. 职责边界
- 本缓存**只存已被服务端确认的历史消息**（有真实 `id`）。
- **未确认/失败的待发消息由 outbox 负责**（`_tempId`）——二者职责分离，渲染层合并。
- 与 outbox 一样按 `conversationId` 分键、每会话上限 50 条。

## 2. 统一常量
| 常量 | 值 | 说明 |
|------|----|------|
| `MAX_PER_CONV` | 50 | 每会话缓存最近 50 条（与 outbox 一致） |
| schema version | `v1` | 缓存键带版本，破坏性变更时整体弃用 |
| 键格式 | `msgcache_v1_<conversationId>` | 逻辑键；各端按载体映射 |

## 3. 存储载体（载体不同，契约一致）
| 端 | 载体 | 理由 |
|----|------|------|
| Web/Windows | **IndexedDB** | 历史体积大，localStorage 5MB+同步阻塞不适合 |
| Android | **Room** | 结构化、成熟 |
| iOS | **FileManager JSON**（每会话一文件） | 复刻 OutboxStore 模式，比 UserDefaults 适合较大历史 |

## 4. 统一 API（各端同名，签名按语言适配）
```
load(convId)            -> Message[]        // 最近50，按 created_at 升序
save(convId, msgs)      -> void             // 覆写为 recent50（内部截断+排序）
remove(convId, msgId)   -> void             // 撤回/删除单条
clear(convId?)          -> void             // 有参=清该会话；无参=全清(登出)
```

## 5. 合并算法（三端同款）
```
enterConversation(convId):
    cached  = cache.load(convId)     # 已确认历史
    pending = outbox.load(convId)    # 失败/待发
    render(merge(cached, pending))   # 立即首屏
    server  = api.history(convId)    # 异步
    onArrive(server):
        merged = dedupById(server ∪ cached)   # server 版本优先(覆盖旧文案)
        cache.save(convId, recent50(merged))
        render(merge(merged, outbox.load(convId)))
```
- **去重键**：`msg.id`；`_tempId` 消息不进历史缓存。
- **dedupById**：服务端版本覆盖缓存版本（解决「缓存旧、服务端已编辑」）。
- **merge(history, outbox)**：复用各端**现有** outbox 合并逻辑，零新增分歧。
- **排序**：`created_at` 升序，`id` 作 tie-break（与 outbox/后端游标一致）。

## 6. 写入时机
| 事件 | 动作 |
|------|------|
| history 拉取成功 | `save(convId, recent50(server∪cached))` |
| 收到 socket 新消息（真实 id） | `save`（追加后截断 50） |
| 消息被撤回 | `remove(convId, msgId)` |
| 消息被编辑 | `save`（按 id 覆写） |

## 7. 失效与隐私红线（三端必须实现 + 各自测试）
| 场景 | 处理 | 级别 |
|------|------|------|
| 退出登录 / 切换账号 | `clear()` 全清 | 🔴 **隐私必须** |
| 清空聊天记录 | `clear(convId)` | 🔴 |
| 阅后即焚消息（`burn_after`） | **不入缓存**（save 前过滤） | 🔴 隐私必须 |
| schema 破坏性升级 | 换 version 前缀，旧键整体弃用 | 🟡 |

> ⚠️ 阅后即焚消息**绝不落盘**；登出**必须清缓存**。三端各需对应测试用例。

## 8. 测试基线（各端对齐用例）
1. save→load 往返一致
2. 超过 50 条只留最近 50
3. 按 id 去重、server 覆盖 cache
4. remove 删单条
5. clear(convId) / clear() 生效
6. 阅后即焚消息不落盘
7. 载体异常（配额满/隐私模式/文件损坏）静默降级，不抛错

## 9. 落地阶段
- **P0** 本契约 + 各端 Store 骨架
- **P1 Web 先行**（IndexedDB + vitest + e2e）← 参考实现/测试基线 ✅
- **P2** Android ✅ —— `MsgCacheStore.kt`（SharedPreferences + kotlinx.serialization，
  沿用已上线 OutboxStore 载体形态；语义 1:1 对齐 msgCache.js 的 normalize/mergeById）。
  接入 `ChatViewModel`（首屏 primeFromCache / history 落盘 / socket 追加 / 删除·撤回 remove /
  编辑覆写 / 清空 clear(convId)）与 `SessionManager`（登出·注销·401 → clear() 全清，隐私红线）。
  单测 `MsgCacheStoreTest`（9 例，纯 JVM）覆盖 Web vitest 基线全部用例。
  > 载体选型说明：契约初拟 Room，实际落地改用 SharedPreferences+Json——复刻同项目已上线、
  > 经生产验证的 OutboxStore 形态，零新增依赖、逻辑内核纯函数可 JVM 单测（无需 instrumented），
  > 与「复用现有 outbox、零新增分歧」一致。阅后即焚在后端为**会话级**设置，故隐私红线在
  > ChatViewModel 按 burnAfter>0 跳过 save（消息 DTO 无独立 burn 字段）。
- **P3** iOS ✅ —— `MsgCacheStore.swift`（FileManager JSON，每会话一文件，目录 `vxin_msgcache_v1/`
  于 Caches；`Message` 仅 Decodable，复刻 OutboxStore 用独立 `Cached: Codable` 快照落盘）。
  语义 1:1 对齐 msgCache.js 的 `normalize`/`mergeById`。接入 `ChatViewModel`（首屏 primeFromCache /
  history mergeById 落盘 / socket 追加 / 删除·撤回·批删 remove / 编辑覆写 / 清空 clear(convId)）
  与 `SessionStore`（登出·注销 → clear() 全清，隐私红线）。单测 `VxinTests/MsgCacheStoreTests`
  （14 例，XCTest：normalize/mergeById 纯逻辑 + FileManager IO 往返，注入临时目录）覆盖 Web
  vitest 基线全部用例。测试 target 已加入 `project.yml`（`VxinTests`，bundle.unit-test）。
  > 阅后即焚同 Android：后端为会话级设置，隐私红线在 ChatViewModel 按 burnAfter>0 跳过 save。
- **P4** 三端隐私失效对齐 + 回归 —— 三端登出/切账号/清空聊天/阅后即焚均已各自实现并测试，语义一致。
  **CI 回归门禁已三端接入**：
  - Web：`ci.yml` 新增 `web-unit` job 跑 `npm test`（vitest，含 `msgCache.test.js` 12 例）。
  - Android：`android-build.yml` 在打 APK 前跑 `./gradlew testDebugUnitTest`（含 `MsgCacheStoreTest` 9 例），失败即中止。
  - iOS：`ios-build.yml` 在编译后跑 `xcodebuild test -only-testing:VxinTests`（含 `MsgCacheStoreTests` 14 例，动态挑选可用模拟器）。
  三端单测报告均作为 CI artifact 上传。

后端**无需改动**（复用 `GET /messages/conversation/:id` 游标 history 与 `/missed`）。
