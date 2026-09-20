# 投聊第二轮 P0/P1 修复 · 批次 1

日期：2026-09-20（UTC）。仅修改隔离工作树 `/home/ubuntu/touliao-fix-wt-20260920`；分支 `fix/p0p1-round2-20260920`，起点 `45dccd9963cad8dec00ef8d13019207491016fb4`，起始工作区干净。未执行 commit/stash/checkout/push/merge/tag/reset/clean、依赖安装或部署。

已先读取 `/home/ubuntu/touliao-audit-2026-09-17/FINAL_AUDIT.md` 第 304–362 行四项原文，并参考 `CODEX_AUDIT_part1_backend.md` 和 `CODEX_VERIFY_234.md` 的复现说明。只处理 F-01/F-03/F-02/F-06，未开始第 2 批。

验证边界：所有验收进程以 `env -i PATH="$PATH"` 启动，测试环境强制隔离 SQLite/上传目录和合成凭据；未连接生产数据库、真实推送或支付。后端走实际 Express 路由、鉴权、业务服务和 SQLite worker；因沙箱禁止监听端口，`f02-inprocess-http.cjs` 仅替换 HTTP 传输，消息/授权/事务逻辑未 mock。资金崩溃测试确实启动并 SIGKILL 本次创建的测试子进程。没有以环境错误充当漏洞复现。

全部原始日志位于 [batch1-evidence](batch1-evidence/)。下列输出为实际日志节选，ANSI 颜色码已去除；完整日志保留原样。后端沿用仓库测试的 `--forceExit` 收尾方式（应用级定时器），关键 writer 已在 afterAll 等待关闭；不能据此宣称应用无残留句柄。

## F-01 Nginx 反代下全站共用每分钟 30 次 Socket 握手额度

- 状态: FIXED_UNVERIFIED
- 根因(一句话): Socket 以代理 TCP 地址作为所有客户端的共同限流键，Express trust proxy 不会替它解析客户端 IP。
- 改动文件(逐个列出,注明每个文件归属本条):
  - `backend-v2/src/realtime/index.js`（归属 F-01）
  - `backend-v2/test/f01-proxy-handshake.test.js`（归属 F-01）
  - `backend-v2/test/f01-proxy-handshake.live.cjs`（归属 F-01）
- 复现证据(修复前失败输出):

执行命令（同一基线验收运行同时复现四项；日志 `backend-before.log`）：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit test/f01-proxy-handshake.test.js test/f03-clear-role.test.js test/f02-file-forward-auth.test.js test/f06-financial-idempotency.test.js
```

```text
  ● 31 concurrent proxy handshakes with distinct client IPs each get their own quota

    expect(received).toHaveLength(expected)

    Expected length: 31
    Received length: 30
    Received array:  ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok", …]

```

- 修复后测试命令 + 真实输出:

只信 TCP 对端 `127.0.0.1` / `::1` 的单值 `X-Real-IP`；不使用 XFF，非法/多值头回落 TCP 对端。统一 IPv6 压缩写法及 IPv4-mapped IPv6。保留每 IP 30 次/60 秒、每账号 5 个并发 Socket，新增独立每进程 6000 次/60 秒保护；已被同 IP 限流的请求不消耗全局额度。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose test/f01-proxy-handshake.test.js test/f03-clear-role.test.js test/f02-file-forward-auth.test.js test/f06-financial-idempotency.test.js test/p0-schema-drift.test.js
```

```text
PASS test/f01-proxy-handshake.test.js
  ✓ 31 concurrent proxy handshakes with distinct client IPs each get their own quota (18 ms)
  ✓ same source reconnect: 30 succeed, 31st denied despite rotating XFF (13 ms)
  ✓ direct untrusted peer cannot spoof forwarding headers (13 ms)
  ✓ equivalent addresses 2001:db8::1 and 2001:0db8:0:0:0:0:0:1 share quota (15 ms)
  ✓ equivalent addresses 192.0.2.1 and ::ffff:192.0.2.1 share quota (11 ms)
  ✓ invalid, multiple and missing X-Real-IP fall back to the TCP peer (10 ms)
  ✓ unauthenticated flood from one client does not consume a different client quota (354 ms)
  ✓ window expiry permits reconnect and account socket cap remains enforced (9 ms)
  ✓ independent global budget limits distributed unauthenticated handshakes and resets (505 ms)
```

真实 Nginx 测试没有删去，另存 `.live.cjs` 并明确执行：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --testMatch '**/test/f01-proxy-handshake.live.cjs'
```

```text
listen EPERM: operation not permitted 127.0.0.1
Test Suites: 1 failed, 1 total
Tests:       5 failed, 5 total
Time:        1.69 s
```

日志：`f01-live-after-blocked.log`，exit=1。实际中间件 9 项通过，但反代网络链路未验证，因此不标 VERIFIED。

- 未解决/风险: 缺少允许本机监听的隔离执行环境；须在该环境运行上述 `.live.cjs`，验证真实 Nginx 下 31 个源 IP 和覆盖伪造头。6000 为独立全局保护阈值，未做容量压测；限流为每进程内存状态，重启清零、多进程不共享。共享 NAT 用户仍共用该 NAT 的 30 次额度，属于原有限制。仅适配报告所述本机反代；非 loopback 代理默认不受信任。
- 兼容性(与旧客户端/旧服务端): 无客户端协议或数据库变更；旧客户端可使用新服务端。旧服务端仍有代理共享额度问题。可信代理必须覆盖 X-Real-IP（审计指定 Nginx 配置已这样做）；本机直连进程属于此信任边界。
- 回滚建议: 按本条文件恢复代码即可，无迁移；会重新引入代理共用额度。勿移除代理覆盖头配置。

## F-03 任意成员可不可逆清空整个会话的所有人消息

- 状态: VERIFIED
- 根因(一句话): 全员清空只检查成员资格，没有检查群主/管理员角色即清除所有人的消息正文和文件引用。
- 改动文件(逐个列出,注明每个文件归属本条):
  - `backend-v2/src/modules/conversations/conversations.service.js`（归属 F-03）
  - `backend-v2/test/f03-clear-role.test.js`（归属 F-03）
- 复现证据(修复前失败输出):

执行前述基线后端命令（完整命令同 F-01，日志 `backend-before.log`）：

```text
  ● ordinary member is denied and everyone else retains the original body

    expect(received).toEqual(expected) // deep equality

    - Expected  - 4
    + Received  + 4

      Object {
        "message": Object {
    -     "content": "synthetic group history",
    -     "deleted": 0,
    -     "file_url": "/uploads/files/f03.txt",
    +     "content": "",
    +     "deleted": 2,
    +     "file_url": "",
        },
    -   "status": 403,
    +   "status": 200,
      }

      20 |   const before = message(id);
```

- 修复后测试命令 + 真实输出:

采用审计验证标准明确允许的 **403 路径**：群内全员清空仅 owner/admin 可执行；普通成员请求被拒绝，不偷偷改为不同的清空语义，既有个人清空全部仅写本人的 `conversation_clears` 水位。角色实时读库，并与清空及既有 `audit_logs` 记录放入同一个 IMMEDIATE 事务；审计写入失败则消息和水位一起回滚。拒绝操作也记录审计，不记录消息正文。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose test/f01-proxy-handshake.test.js test/f03-clear-role.test.js test/f02-file-forward-auth.test.js test/f06-financial-idempotency.test.js test/p0-schema-drift.test.js
```

```text
PASS test/f03-clear-role.test.js
  ✓ ordinary member is denied and everyone else retains the original body (24 ms)
  ✓ owner can clear and the operation is durably audited (13 ms)
  ✓ admin can clear and the operation is durably audited (7 ms)
  ✓ nonmember and recently demoted admin are denied without trusting cached membership (9 ms)
  ✓ parallel denied requests and retries cannot erase history (13 ms)
  ✓ audit write failure rolls the destructive operation back (8 ms)
  ✓ existing private bidirectional clear and personal clear-all remain available (7 ms)
```

- 未解决/风险: 管理员/群主获准操作仍按既有设计不可逆；本次只加角色门控和审计，不提供历史恢复。F-04 离线同步收敛不在本批，未改变同步协议。测试覆盖同时请求、重复拒绝、角色降级、事务异常，未验证真实网络广播（既有网络回归也被 EPERM 阻断）。审计使用原表及原保留策略，不新增字段或表。
- 兼容性(与旧客户端/旧服务端): 新服务端向旧普通成员客户端返回既有错误格式的 403；入口仍显示，未隐藏或重做 UI；owner/admin、私聊双向清空及个人 clear-all 的语义保持。旧服务端不具备门控，更新客户端本身不能修复。
- 回滚建议: 回退本条服务文件；已写 audit_logs 可保留。回滚代码不能恢复已获授权清空的正文，也会恢复普通群成员越权风险。

## F-02 转发可把植入的附件引用升级为访问授权

- 状态: VERIFIED
- 根因(一句话): 发送只看文件是否登记，转发把消息会话的成员资格当成附件权利，并在消息提交前写入下载 share。
- 改动文件(逐个列出,注明每个文件归属本条):
  - `backend-v2/src/utils/fileRegistry.js`（归属 F-02）
  - `backend-v2/src/realtime/handlers/file.js`（归属 F-02）
  - `backend-v2/src/modules/messages/messages.service.js`（归属 F-02）
  - `backend-v2/test/f02-file-forward-auth.test.js`（归属 F-02）
  - `backend-v2/test/f02-inprocess-http.cjs`（归属 F-02）
- 复现证据(修复前失败输出):

执行前述基线后端命令（完整命令同 F-01，日志 `backend-before.log`），三个合成账号下载→植入历史引用→转发→下载：

```text
  ● historical planted message cannot be forwarded into a download authorization

    expect(received).toEqual(expected) // deep equality

    - Expected  - 3
    + Received  + 9

      Object {
    -   "download": 403,
    -   "shares": Array [],
    -   "status": "failed",
    +   "download": 200,
    +   "shares": Array [
    +     Object {
    +       "conversation_id": "f02-2-target",
    +       "created_at": 1789909915,
    +       "path": "/uploads/files/f02-2.txt",
    +     },
    +   ],
    +   "status": "success",
      }

      56 |   expect((await download(f, c)).status).toBe(403);
```

另一个真实失败证明写消息失败时旧实现遗留授权：

```text
  ● failed message write cannot leave a share; same operation can retry after rollback

    expect(received).toHaveLength(expected)

    Expected length: 0
    Received length: 1
    Received array:  [{"conversation_id": "f02-6-target", "created_at": 1789909915, "path": "/uploads/files/f02-6.txt"}]
```

Socket 植入用例同样实际失败：`Expected: false / Received: true`，详见日志。

- 修复后测试命令 + 真实输出:

发送和转发统一依据 file_registry 的 owner_id 或**原会话当前成员**授权，不相信消息引用或历史 share。授权和目标成员资格在 worker 提交时再次校验；share、消息、序列事件同事务提交。SQL 仅忽略重复授权主键，权限失败利用 NOT NULL 约束拒绝并回滚。合法 Socket 发送也原子写授权，因此正向用例明确检查 source/target 两个合法 share，拒绝用例仍要求零 share。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose test/f01-proxy-handshake.test.js test/f03-clear-role.test.js test/f02-file-forward-auth.test.js test/f06-financial-idempotency.test.js test/p0-schema-drift.test.js
```

```text
PASS test/f02-file-forward-auth.test.js
  ✓ unrelated account: download denied -> Socket planting denied -> no share grant (37 ms)
  ✓ historical planted message cannot be forwarded into a download authorization (26 ms)
  ✓ owner may send and forward to another conversation (60 ms)
  ✓ original-member may send and forward to another conversation (31 ms)
  ✓ removed original member cannot plant or forward using a historical URL (6 ms)
  ✓ failed message write cannot leave a share; same operation can retry after rollback (84 ms)
  ✓ parallel permitted forwarding is atomic and share uniqueness survives retries (32 ms)
  ✓ sync-event failure rolls back both the message and its grant (20 ms)
  ✓ membership revoked in original conversation before queued grant commits is rejected (7 ms)
  ✓ membership revoked in destination conversation before queued grant commits is rejected (3 ms)
```

- 未解决/风险: 已经被旧漏洞写入的历史 shares 和文件注册表回填污染不在本次自动清理范围；仅凭现有数据无法安全区分合法历史转发与攻击，需要独立审查、撤销确认非法的授权。本次没有查询或改写生产数据。未注册的历史 CDN 直链不能继续发送/转发，必须具备服务端上传登记；这是堵住存在性授权漏洞所必需的收紧。撤回/下载 stillLive 原有规则未重写。
- 兼容性(与旧客户端/旧服务端): 请求/ACK/批次结果结构不变；无数据库迁移。旧客户端向新服务端引用无权文件会失败。按报告的严格 owner/原会话规则，只有被转发目标会话成员、但非 owner/原会话成员的用户仍可按既有下载授权阅读，不能再以该引用继续转发；这是明确的授权边界。新客户端配旧服务端仍存在漏洞。
- 回滚建议: 同时回退本条三个业务文件，避免调用接口错配；无表结构回滚。已合法生成的 shares 可保留，不能无差别删除整个 share 表；回滚会重新开放漏洞。

## F-06 axios 拦截器对所有方法自动重放,资金类 POST 无幂等保护

- 状态: VERIFIED
- 根因(一句话): Axios 将网络错误和 5xx 的自动重试用于写请求，而转账/发红包每次执行都生成新的业务标识。
- 改动文件(逐个列出,注明每个文件归属本条):
  - `backend-v2/src/db/schema.js`（归属 F-06）
  - `backend-v2/src/db/migrations/f06-financial-idempotency.sql`（归属 F-06）
  - `backend-v2/src/modules/wallet/financialIdempotency.js`（归属 F-06）
  - `backend-v2/src/modules/wallet/wallet.controller.js`（归属 F-06）
  - `backend-v2/src/modules/wallet/wallet.service.js`（归属 F-06）
  - `backend-v2/src/modules/redpackets/redpackets.controller.js`（归属 F-06）
  - `backend-v2/src/modules/redpackets/redpackets.service.js`（归属 F-06）
  - `backend-v2/test/f06-financial-idempotency.test.js`（归属 F-06）
  - `backend-v2/test/fixtures/f06-financial-process.cjs`（归属 F-06）
  - `web/src/utils/axiosInterceptor.js`（归属 F-06）
  - `web/src/utils/financialRequest.js`（归属 F-06）
  - `web/src/components/TransferModal.jsx`（归属 F-06）
  - `web/src/components/RedPacketModal.jsx`（归属 F-06）
  - `web/src/utils/f06-axios-retry.test.js`（归属 F-06）
- 复现证据(修复前失败输出):

Web 使用实际 Axios adapter 模拟第一次请求已经记账但响应返回 502/504/500 或超时：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/web
env -i PATH="$PATH" node node_modules/.bin/vitest run --configLoader native --no-cache src/utils/f06-axios-retry.test.js
```

```text
AssertionError: expected { result: 'success', debits: 2 } to deeply equal { result: 'uncertain', debits: 1 }

- Expected
+ Received

  {
-   "debits": 1,
-   "result": "uncertain",
+   "debits": 2,
+   "result": "success",
  }

 ❯ src/utils/f06-axios-retry.test.js:30:56
     28|   const result = f.client.post('/api/wallet/transfer', { amount: 10 })…
     29|   await vi.runAllTimersAsync();
```

同次 Web 基线输出：`Test Files 1 failed (1)`、`Tests 9 failed | 3 passed (12)`，完整日志 `web-before.log`。

后端执行前述基线命令，实际隔离库中同键第一次提交后再并发重试五次：

```text
  ● transfer committed with a lost response then retried concurrently only debits once

    expect(received).toBe(expected) // Object.is equality

    Expected: 1990
    Received: 1940
```

```text
  ● redpacket committed with a lost response then retried concurrently only debits once

    expect(received).toBe(expected) // Object.is equality

    Expected: 1930
    Received: 1880
```

- 修复后测试命令 + 真实输出:

自动重试仅 GET/HEAD/OPTIONS；取消请求不重试；401 刷新重放同样限制为安全方法，资金弹窗显式 skipRetry。转账、发红包分别生成并复用同一用户意图的 Idempotency-Key，输入改变使用新 key，凭据刷新不会换 key，切账号隔离；useRef 阻止渲染前快速双击并发发送。服务端按 actor/operation/key 唯一约束，IMMEDIATE 事务覆盖账本、业务消息、同步事件和结果记录；同 key 不同参数返回 409，重试返回原结果而不重复广播。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose test/f01-proxy-handshake.test.js test/f03-clear-role.test.js test/f02-file-forward-auth.test.js test/f06-financial-idempotency.test.js test/p0-schema-drift.test.js
```

```text
PASS test/f06-financial-idempotency.test.js (5.618 s)
  ✓ transfer committed with a lost response then retried concurrently only debits once (84 ms)
  ✓ redpacket committed with a lost response then retried concurrently only debits once (39 ms)
  ✓ same key with changed payload is rejected, preserving the original result (35 ms)
  ✓ key is scoped by actor and operation; old clients without a key remain supported (31 ms)
  ✓ invalid idempotency key is rejected before any debit (20 ms)
  ✓ failure after ledger writes rolls back both ledger and idempotency record; retry succeeds (43 ms)
  ✓ two actual processes racing on one key commit exactly one transfer (433 ms)
  ✓ SIGKILL beforeCommit preserves atomicity and retry after restart is safe (293 ms)
  ✓ SIGKILL afterCommit preserves atomicity and retry after restart is safe (300 ms)
  ✓ standalone migration is idempotent and matches the startup migration (3 ms)
```

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/web
env -i PATH="$PATH" NO_COLOR=1 node node_modules/.bin/vitest run --configLoader native --no-cache src/utils/f06-axios-retry.test.js src/utils/axiosSessionRefresh.test.js src/utils/uploadFallback.test.js
```

```text
✓ src/utils/f06-axios-retry.test.js (15 tests) 77ms
Test Files  3 passed (3)
     Tests  27 passed (27)
  Duration  910ms (transform 306ms, setup 0ms, import 1.40s, tests 190ms, environment 1ms)
```

最小迁移：`src/db/migrations/f06-financial-idempotency.sql` 仅建一张幂等结果表；同一 DDL 追加在 schema.js 原 154 条迁移之后，不更改旧下标。已在隔离库启动迁移，并在内存库连续执行 SQL 两次，核对字段、主键和外键与启动迁移一致。`ON DELETE CASCADE` 避免新增表阻断既有注销流程。独立迁移的验证步骤就是上述 `standalone migration ...` 自动测试；未对任何生产库执行。

额外执行迁移前缀门禁：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920
git show 45dccd9963cad8dec00ef8d13019207491016fb4:backend-v2/src/db/schema.js > /tmp/touliao-batch1-baseline-schema.js
env -i PATH="$PATH" node backend-v2/scripts/check-migration-append.js --base-file /tmp/touliao-batch1-baseline-schema.js
```

```text
✅ migrations 数组合规: 前 154 条与 base 完全一致, 尾部追加 1 条 (154 → 155)
```

Web 生产构建（仅输出 /tmp，不触发发布）：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/web
env -i PATH="$PATH" NO_COLOR=1 node node_modules/vite/bin/vite.js build --configLoader native --outDir /tmp/touliao-batch1-web-build
```

```text
✓ built in 2.11s
```

完整日志 `web-build.log`，exit=0。

- 未解决/风险: 兼容旧客户端时无 key 请求仍允许，服务端无法猜测两次无 key 请求是不是同一意图；旧 Web 的自动重试风险需配套部署新 Web。新版弹窗 key 保存在弹窗生命周期内，关闭/刷新页面后重新手工操作是新意图，不能保证跨浏览器重启自动识别同一笔；服务端本身已验证跨进程重启持久去重。未给所有其他 POST 引入新幂等协议，其自动重放已被禁止；逐条转发保留既有 client_batch_id，模拟充值门控和领取红包既有唯一领取逻辑不改。未测试真实支付或网络网关，响应丢失用实际 Axios adapter 和后端提交后 SIGKILL 分别模拟。幂等记录不自动过期（防延迟重试再次扣款），未来需按业务生命周期设计归档。
- 兼容性(与旧客户端/旧服务端): 新服务端支持缺少 key 的旧客户端，但没有去重保证；带 key 的新客户端得到稳定结果。新客户端遇到旧服务端仍不会自动重放 POST，不过旧服务端忽略 key，手动重试不能去重。新服务端使用 key 前必须应用新表迁移；旧服务端可忽略新增表。非安全方法 401 现在直接返回，用户需完成会话恢复后重新发起；这是消除写请求隐式重放所需的边界。
- 回滚建议: 优先保留禁止写请求自动重试的 Web 修复；整体回退资金逻辑会失去幂等保证。保留新增表和成功结果，不先删表，不重排/删除 schema_migrations 旧记录；仅在完全停用相关新服务后另行评估删除新增表。

## 本批汇总

| ID | 状态 | 已验证 | 尚缺/边界 |
|---|---|---|---|
| F-01 | FIXED_UNVERIFIED | 实际中间件 9 项 | 沙箱禁止本机监听，真实 Nginx 链路未完成 |
| F-03 | VERIFIED | 角色允许/拒绝、并发拒绝、审计失败回滚 7 项 | F-04 离线同步不在本批 |
| F-02 | VERIFIED | 植入/转发/下载、合法转发、退出、原子性/并发 10 项 | 旧污染授权待独立审查；严格原会话再转发边界 |
| F-06 | VERIFIED | 后端 10 项（含实际多进程和 SIGKILL）；Web 新增 15 项 | 旧客户端无 key、关闭弹窗后新操作不保证去重 |

最终联合后端验收包含既有 schema 漂移回归：

```text
Test Suites: 5 passed, 5 total
Tests:       42 passed, 42 total
Snapshots:   0 total
Time:        12.543 s
```

Web 27 项（15 项新增 + 11 项既有会话刷新 + 1 项既有上传 fallback）通过，构建通过。`git diff --check` exit=0，无输出。

**实际执行的复现/验收命令清单**（所有 backend 命令均在 backend-v2，所有 web 命令均在 web；完整命令已在各节贴出）：

1. 基线后端四文件联合命令（上文）：exit=1，19 failed / 9 passed，确实包含四项漏洞断言失败。
2. 初次常规网络版后端三文件命令：同一 Jest 命令、文件 f01/f03/f02，未加 forceExit；EPERM 导致 19 failed，随后手动终止测试运行，环境日志为 `backend-network-blocked.log`，不算漏洞证据。
3. 初次 `node node_modules/.bin/vitest run src/utils/f06-axios-retry.test.js`：共享依赖目录只读，默认 `.vite-temp` 配置缓存 EROFS；改用 `--configLoader native --no-cache` 后产生真实基线断言失败。未写入或修改共享依赖。
4. 基线 Web native/no-cache 命令（上文）：exit=1，9 failed / 3 passed。
5. 第一轮修复后 Jest f01/f03/f02 联合：exit=1，20 passed / 2 failed；失败是正向发送增加原会话合法 share 后用例仍断言只有目标 share，随后改为明确检查两个合法授权；拒绝断言未降低。日志 `backend-first-after.log`。
6. 修复后四文件联合运行：经过正向测试的 key 长度修正后 35 项通过；最终新增迁移验证和保留原 schema 回归后的完整命令为上文 `--verbose` 五文件联合运行，exit=0，42 项通过。
7. 扩展既有 `test/message-broadcast-race.test.js` 的六文件联合运行：exit=1，42 passed / 3 failed；该旧测试 beforeAll 的监听端口被 EPERM 阻断，未修改或删除旧测试。日志 `backend-regression-network-blocked.log`。不能将最终五文件全绿解读为该网络测试已通过。
8. 最终真实 Nginx `.live.cjs` 命令（上文）：exit=1，5 项均被 `listen EPERM` 阻断，日志 `f01-live-after-blocked.log`；保留供具备监听权限的隔离环境复跑。
9. 修复后 Web 三文件命令（上文）：exit=0，27 项通过。
10. Web Vite build native/outDir 命令（上文）：exit=0，构建完成，只输出 `/tmp/touliao-batch1-web-build`。
11. `node scripts/check-migration-append.js --base 45dccd9963cad8dec00ef8d13019207491016fb4` 初次内部 spawnSync git 被 EPERM 阻断；随后实际执行外层 `git show` 导出基线 + `--base-file` 命令，exit=0，154 条前缀一致，只追加 1 条。
12. `git diff --check`：exit=0；`git status --short` / `git branch --show-current` / `git rev-parse HEAD` 用于检查工作树范围与基线。审计和定位使用只读 `rg`、`sed`、`cat`，未访问生产运行配置或真实凭据文件。

**是否还有未覆盖的触发条件：有。** 真实 Nginx/TCP 握手、真实 Socket 广播、容量阈值、多实例限流、真实浏览器刷新后重建资金意图、旧客户端不发送 key、真实网关丢包，以及旧附件授权污染的存量盘点尚未覆盖；各节已说明。没有把这些边界写成已通过，也没有通过隐藏入口、删拒绝测试或改动其他审计项来消除问题。

**改动文件总清单**：如下机器表的 24 个唯一仓库路径（报告和日志写在用户指定的仓库外交付目录，不属于业务提交）。`f02-inprocess-http.cjs` 归属 F-02，F-03/F-06 测试复用它，逐项提交建议先 F-02，再 F-03/F-06；业务代码没有该测试依赖。F-06 的 schema/SQL/资金服务应一起提交。无既有依赖、框架、视觉样式或生产配置变更。

## 文件归属(机器可读)

F-01: backend-v2/src/realtime/index.js, backend-v2/test/f01-proxy-handshake.test.js, backend-v2/test/f01-proxy-handshake.live.cjs
F-03: backend-v2/src/modules/conversations/conversations.service.js, backend-v2/test/f03-clear-role.test.js
F-02: backend-v2/src/utils/fileRegistry.js, backend-v2/src/realtime/handlers/file.js, backend-v2/src/modules/messages/messages.service.js, backend-v2/test/f02-file-forward-auth.test.js, backend-v2/test/f02-inprocess-http.cjs
F-06: backend-v2/src/db/schema.js, backend-v2/src/db/migrations/f06-financial-idempotency.sql, backend-v2/src/modules/wallet/financialIdempotency.js, backend-v2/src/modules/wallet/wallet.controller.js, backend-v2/src/modules/wallet/wallet.service.js, backend-v2/src/modules/redpackets/redpackets.controller.js, backend-v2/src/modules/redpackets/redpackets.service.js, backend-v2/test/f06-financial-idempotency.test.js, backend-v2/test/fixtures/f06-financial-process.cjs, web/src/utils/axiosInterceptor.js, web/src/utils/financialRequest.js, web/src/components/TransferModal.jsx, web/src/components/RedPacketModal.jsx, web/src/utils/f06-axios-retry.test.js
RESIDUAL: none

## 返修记录(第 2 轮)

日期：2026-09-20（UTC）。逐条核对 BATCH1_CLAUDE_REVIEW.md 的 §1、§2、§3、§4，并重读原审计 F-01/F-03/F-02/F-06。返修起点 HEAD 为 bb5f0914c1a48e0a40b80bb386d56d8d22627e3b；本轮没有执行任何 git 提交、push、merge、tag 或生产连接。

边界解释：业务、测试和 CI 文件仅修改隔离工作树。用户明确指定的本报告“末尾追加”作为交付物的唯一例外；主仓库的其它文件未改。测试与构建临时产物只写 /tmp 或既有隔离测试目录。全部测试进程以 env -i 启动，使用 testEnv.js 的合成账号、SQLite 和临时上传目录；未读取生产凭据。原报告正文逐字保留，前文过时结论以本节为准。

最终结果：后端 5 个测试文件、62 项通过；Web 5 个文件、69 项通过；构建、定向 ESLint、迁移前缀门禁通过。真实 Nginx/Socket 的 8 项仍被本沙箱 listen EPERM 阻断；既有网络回归也因监听拒绝退出，不能称本轮全套网络验收通过。原始日志位于 /tmp/touliao-batch1-round2-evidence，关键真实输出直接摘录如下。没有把未执行的 CI 或其它环境结果记成本机成功。

记录中的 V-B/V-W 等指文末“验证命令与真实输出”的实际完整命令；同一联合运行的原始输出按对应复审点摘录，重复展示不重复计数。

### §1 F-01 主修与绕过路径

- 处理方式: 已修（接受独立复审的原修复有效结论，业务逻辑保持）
- 改动文件: 本轮业务文件无新增修改；沿用 backend-v2/src/realtime/index.js。
- 新增/修改的测试: 保留不同源 IP 允许、同源第 31 次拒绝、XFF/X-Real-IP 伪造、IPv6 等价形式、账号并发上限测试。
- 技术依据/边界: index.js:68 的 handshakeIp 只信规范化后的 loopback TCP 对端；server.js:194 只监听 127.0.0.1；deploy/nginx/touliao-cc.conf:110/111 用 $remote_addr 覆盖两种头。rg 在业务代码中仅发现 handshakeIp 使用 handshake.address，没有另一个绕过此判断的握手入口。复审者曾在允许监听的环境跑通 5 项 Nginx 测试，这份独立证据保留；本轮新增网络门禁的状态另列。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f01-proxy-handshake.test.js
  ✓ 31 concurrent proxy handshakes with distinct client IPs each get their own quota (15 ms)
  ✓ same source reconnect: 30 succeed, 31st denied despite rotating XFF (25 ms)
  ✓ direct untrusted peer cannot spoof forwarding headers (16 ms)
  ✓ equivalent addresses 2001:db8::1 and 2001:0db8:0:0:0:0:0:1 share quota (24 ms)
  ✓ equivalent addresses 192.0.2.1 and ::ffff:192.0.2.1 share quota (11 ms)
  ✓ window expiry permits reconnect and account socket cap remains enforced (12 ms)
```

- 当前状态: VERIFIED

### §1 F-01 残留 1/2/3：IPv6 /64、未认证全局额度、容量

- 处理方式: 部分修（补边界测试；接受残留风险，未擅自调整限流政策）
- 改动文件: backend-v2/test/f01-proxy-handshake.test.js。
- 新增/修改的测试: 新增同一 /64 内 31 个不同 IPv6 地址各自获得额度；保留耗尽 6000 全局额度与窗口恢复测试。
- 技术依据/边界: 残留 1 确认存在：按 /128 而非 /64 合并。残留 2 确认存在：index.js:77/126 的全局预算在 JWT 校验前，分布式未认证连接可耗尽它。残留 3 确认无容量压测依据：6000 是现有限额，不是经过实测的容量承诺。改为 /64 聚合、移除全局保护或臆改容量会改变审计要求之外的限流策略；本轮不这样做。这三项仅有保护与已知限制，不能标为已消除。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f01-proxy-handshake.test.js
  ✓ independent global budget limits distributed unauthenticated handshakes and resets (725 ms)
  ✓ documented residual: rotating 31 IPv6 addresses within one /64 has separate quotas (12 ms)
```

- 当前状态: MITIGATED

### §1 F-01 残留 4 / §4：真实 Nginx 测试默认发现与 CI

- 处理方式: 已修
- 改动文件: backend-v2/test/f01-proxy-handshake.live.test.js；backend-v2/test/f01-proxy-handshake.live.cjs；.github/workflows/ci.yml。
- 新增/修改的测试: 新增 .test.js 入口加载原 .live.cjs；live 夹具使用独立 f01-live-user，避免同轮与原单测撞主键；CI 安装 nginx，与 Redis 一起作为集成测试工具。
- 技术依据/边界: 未改生产 Nginx 配置，未改变 npm 依赖。默认 Jest 已发现该测试，不使用 skip 或吞掉监听错误。仍不能在当前沙箱建立 TCP listener，默认门禁真实执行结果是失败而非假绿。
- 测试命令 + 真实输出: V-D，exit=0；V-L，exit=1。

```text
/home/ubuntu/touliao-fix-wt-20260920/backend-v2/test/f02-file-socket.live.test.js
/home/ubuntu/touliao-fix-wt-20260920/backend-v2/test/f01-proxy-handshake.live.test.js

listen EPERM: operation not permitted 127.0.0.1
FAIL test/f02-file-socket.live.test.js
FAIL test/f01-proxy-handshake.live.test.js
PASS test/f01-proxy-handshake.test.js
Test Suites: 2 failed, 1 passed, 3 total
Tests:       8 failed, 10 passed, 18 total
Time:        5.47 s, estimated 6 s
```

- 当前状态: FIXED_UNVERIFIED

### §1 F-03 / §4：拒绝审计及允许/拒绝成对验证

- 处理方式: 已修
- 改动文件: backend-v2/test/f03-clear-role.test.js。
- 新增/修改的测试: 普通成员 403 后精确断言一条 permission_denied、status=denied、正确 user_id、role=member、deleted=0、cleared_rowid=null，且未新增水位；保留 owner/admin 成功审计、并发拒绝、降级和审计失败回滚。
- 技术依据/边界: conversations.service.js:507 的 IMMEDIATE 事务实时取角色；515–520 为拒绝审计。messages.routes.js:676 是全员清空路由，controller:72 调此服务；clearAllConversations:549 只写本人水位。messages.service.js:438/476 的批量与单条删除仍校验本人或 owner/admin；后台单条删除受 adminAuth 保护。rg 未发现 WebSocket 清空事件。Web GroupInfo.jsx:428 和 iOS Features/Chat/ConversationListViewModel.swift:111 会显示错误，未改客户端入口。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f03-clear-role.test.js
  ✓ ordinary member is denied and everyone else retains the original body (21 ms)
  ✓ owner can clear and the operation is durably audited (7 ms)
  ✓ admin can clear and the operation is durably audited (13 ms)
  ✓ nonmember and recently demoted admin are denied without trusting cached membership (8 ms)
  ✓ parallel denied requests and retries cannot erase history (14 ms)
  ✓ audit write failure rolls the destructive operation back (20 ms)
  ✓ existing private bidirectional clear and personal clear-all remain available (12 ms)
```

- 当前状态: VERIFIED

### §1 F-03 残留：拒绝操作的审计写放大

- 处理方式: 部分修（确认风险，保留必要拒绝审计）
- 改动文件: 无额外业务改动。
- 新增/修改的测试: 同一联合验收保留 6 个并发拒绝请求，均为 403 且消息未删除。
- 技术依据/边界: service:515/520 每次拒绝确实写审计；该 DELETE 路由没有新增专用限流。auditLogger.js:262 的保留清理不能替代频率上限。此项属于可重复请求引起的存储开销，没有证据可宣称已解决；本轮不移除审计、不新增未评估的按用户限额。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f03-clear-role.test.js
  ✓ parallel denied requests and retries cannot erase history (14 ms)
```

- 当前状态: MITIGATED

### R-1 / §2-3 / §4：收到的表情、头像及无会话类别

- 处理方式: 已修
- 改动文件: backend-v2/src/utils/fileRegistry.js；backend-v2/src/modules/messages/messages.service.js；backend-v2/test/f02-file-forward-auth.test.js。
- 新增/修改的测试: 表情和头像：接收者允许发送/转发，未登录下载拒绝，目标非成员即使引用公开类别也在提交时拒绝。还覆盖未登记的合法表情书签发送，以及路径穿越、编码路径、查询串和大小写别名拒绝。
- 技术依据/边界: app.js:143–146 已将这两个本地类别定义为登录可见。fileRegistry.js:45 只对 /uploads/(stickers|avatars)/单个安全文件名 放行；原会话 SQL 仍约束受保护文件。fileShareOp:64 保留提交时的目标成员验证。没有按消息 type=image 或“无 conversation_id”一概放行，避免私密朋友圈也被开放。没有把 URL 中的 ../ 或 % 编码当成公开类别。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f02-file-forward-auth.test.js
  ✓ recipient can send and forward public stickers without original membership (25 ms)
  ✓ recipient can send and forward public avatars without original membership (21 ms)
  ✓ public category aliases cannot bypass private-file authority (4 ms)
  ✓ HTTP sticker send permits public-recipient and commits its reference atomically (28 ms)
```

- 当前状态: VERIFIED

### §1 F-02 其它入口：不认同“自己的 user_stickers 记录即可信 URL”

- 处理方式: 已修；不认同复审关于此入口不可控的判断（已实测）
- 改动文件: backend-v2/src/modules/messages/messages.service.js；backend-v2/test/f02-file-forward-auth.test.js。
- 新增/修改的测试: 新增真实 Express 的 collect→send 拒绝探针、合法私有文件所有者/公开表情接收者允许用例，以及 saveUploadedFile 同步事件失败时消息/share/序列全部回滚。
- 技术依据/边界: stickers.controller.js:42–55 的 collect 直接接受请求体 url 并只做来源前缀检查；:72 的 SELECT user_stickers 只能证明书签属于用户，不能证明文件属于用户。修前探针实际返回 200 并写入植入消息。现在 saveUploadedFile:268 预检，:287 将 fileShareOp 放入消息/同步事件同一事务。普通上传 controller:116/130、分片 chunk.js:155/165 先登记原文件再调用共用服务，合法路径仍成立。该发现属于 F-02 的其它发送入口，不是扩大到下一批。前轮 forward 仍会拒绝此植入消息，本轮修的是发送校验漏口，不夸称已经复现新的下载授权升级。
- 测试命令 + 真实输出: 修前单跑 f02-file-forward-auth.test.js（命令为 V-B 仅保留该文件），exit=1；修后 V-B，exit=0。

```text
  ● collecting a private URL as a sticker cannot bypass the HTTP file-message entry

    expect(received).toBe(expected) // Object.is equality

    Expected: 403
    Received: 200


PASS test/f02-file-forward-auth.test.js
  ✓ collecting a private URL as a sticker cannot bypass the HTTP file-message entry (21 ms)
  ✓ HTTP sticker send permits private-owner and commits its reference atomically (21 ms)
  ✓ HTTP sticker send permits public-recipient and commits its reference atomically (28 ms)
  ✓ upload sync-event failure rolls back both the message and its grant (14 ms)
```

- 当前状态: VERIFIED

### R-2 / §4：二次转发与不可重试错误

- 处理方式: 部分修（修正 retryable；保留审计指定的原始归属规则）
- 改动文件: backend-v2/src/modules/messages/messages.service.js；backend-v2/test/f02-file-forward-auth.test.js。
- 新增/修改的测试: 实际先由 A 转发到 T：C 可下载，但不能以目标会话 share 再授权；B 为原会话成员，可二次转发。断言拒绝的 failed_message_ids 有原消息 ID、retryable_message_ids 为空且无新增 share；真正写入失败仍可重试。
- 技术依据/边界: 原审计 FINAL_AUDIT.md F-02 明确要求 owner_id 或原会话成员资格。现有 shares 表只有 path/conversation_id/created_at（schema.js:556），没有授权者、可信版本或来源链，复审也承认有存量污染；简单信任它会重新放大旧污染，不能为了恢复二次转发而改回漏洞。文件消息的普通阅读权不视为转授权资格。messages.service.js:410 现仅将实际写失败标为 retryable，权限/消息无效/无目标不会被建议反复重试。这是按审计和现存 schema 作出的保守假设，不冒充已经获得新的产品授权。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f02-file-forward-auth.test.js
  ✓ historical planted message cannot be forwarded into a download authorization (9 ms)
  ✓ failed message write cannot leave a share; same operation can retry after rollback (29 ms)
  ✓ second forward is allowed for original members but read-only recipients cannot mint another share (24 ms)
```

- 当前状态: MITIGATED

### R-6 / §2-2 / §4：历史 CDN 直链

- 处理方式: 部分修；不认同无条件恢复未登记 CDN 引用（附技术证据）
- 改动文件: backend-v2/test/f02-file-forward-auth.test.js；本轮不放宽 realtime/handlers/file.js 的受保护 URL 检查。
- 新增/修改的测试: 同一个合成 CDN 地址：未登记的所有者拒绝；登记后无关用户仍拒绝；已登记 owner 和原会话成员分别可以发送、转发。
- 技术依据/边界: file.js:60–70 的域名前缀只能证明来源域名，不能证明该用户拥有对象；fileRegistry 的精确 path/owner/原成员校验对绝对 URL 也有效，所以“所有 CDN 都一律拒绝”不准确。当前 upload.controller.js:49–57 为新上传登记 /uploads/files/...，下载由 app.js:266 在授权后生成短时签名。没有归属登记的历史 CDN 直链仍受影响，不能凭主机名将它补成用户授权，也不扫描或改写生产数据。外部已公开对象/旧签名的直接访问不能靠本次应用补丁撤销。
- 测试命令 + 真实输出: V-B，exit=0；CDN 域名与签名服务只在测试中使用 fixture，不发出外部网络请求。

```text
PASS test/f02-file-forward-auth.test.js
  ✓ CDN references require registered authority: registered owner allowed, stranger and unregistered denied (22 ms)
```

- 当前状态: MITIGATED

### §1 F-02 / §4：朋友圈、缩略图、直链、票据、下载路径

- 处理方式: 已修（核实授权边界并补成对用例）
- 改动文件: backend-v2/test/f02-file-forward-auth.test.js。
- 新增/修改的测试: 私密朋友圈所有者可转发，植入者拒绝；即使 owner 在聊天转发，非可见用户仍不能下载私密朋友圈。原图与缩略图分别测试成员允许/无关账号拒绝、query token 直链、/api/uploads/ticket 发行与票据实际下载。
- 技术依据/边界: app.js:185–200 的 moments 仍由 assertVisible 控制，不能归入表情/头像例外。缩略图独立登记且按精确 path 做第一层授权，文件名的 baseId 匹配仅用于 stillLive；它不能授予其它人的文件权限。/api/uploads/ticket:354/359 与 /uploads:261 共用 resolveUploadAccess。nginx:118–123 的 /uploads 转发到应用；/downloads 的 alias 指向独立的安装包目录，没有映射上传目录。普通 WebSocket send_message 将 file_url 置空，附件事件走 file handler；forward 入口仍走统一服务。没有发现这些变体可绕过本轮授权的证据。未宣称新转发 share 会自动授予另一个独立登记的缩略图 path；本轮未重写此既有精确授权设计。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f02-file-forward-auth.test.js
  ✓ private moments media: owner can forward, planted reference cannot delegate visibility (28 ms)
  ✓ public category aliases cannot bypass private-file authority (4 ms)
  ✓ thumbnail, direct query URL and download ticket enforce the same private-file boundary (52 ms)
```

- 当前状态: VERIFIED

### §4 F-02：伪 socket 测试的传输覆盖

- 处理方式: 部分修（补真实 Socket.IO 集成门禁，保留有效的 handler 单测）
- 改动文件: backend-v2/test/f02-file-socket.live.test.js。
- 新增/修改的测试: 新测试使用真实 socket.io-client、真实 Socket.IO 服务端和生产鉴权中间件/文件 handler：未认证拒绝、植入拒绝且下载仍 403、owner 成功并新增唯一消息/share 后接收者可下载。
- 技术依据/边界: 原 f02 文件里的 socket 对象夹具只证明 handler 逻辑，不能称为传输验收。新 .live.test.js 被默认 Jest 发现，不以 mock 传输替代或跳过环境错误。当前 listener 被系统拒绝，三项新传输断言尚未实际走完。
- 测试命令 + 真实输出: V-D，exit=0；V-L，exit=1。

```text
/home/ubuntu/touliao-fix-wt-20260920/backend-v2/test/f02-file-socket.live.test.js
/home/ubuntu/touliao-fix-wt-20260920/backend-v2/test/f01-proxy-handshake.live.test.js

listen EPERM: operation not permitted 127.0.0.1
FAIL test/f02-file-socket.live.test.js
FAIL test/f01-proxy-handshake.live.test.js
PASS test/f01-proxy-handshake.test.js
Test Suites: 2 failed, 1 passed, 3 total
Tests:       8 failed, 10 passed, 18 total
Time:        5.47 s, estimated 6 s
```

- 当前状态: BLOCKED

### §1 F-02 残留 1/2：存量污染 shares 与 stillLive

- 处理方式: 部分修（确认存在，未自动清理）
- 改动文件: 无额外生产数据或下载逻辑改动。
- 新增/修改的测试: 三账号拒绝、历史植入、成员撤销、消息/事件失败回滚与并发 share 唯一性继续通过。
- 技术依据/边界: app.js:170–182 下载仍接受历史 shares；schema.js:556 没有来源字段，无法安全区分旧合法转发与污染授权。fileRegistry.js 的 backfill 还可能保留旧数据归属污染，这不在新写入修复的证明范围。stillLive 只收紧已有授权，不会把无权用户提升为有权用户。需要单独的数据盘点/可信来源方案，本轮禁止生产连接，未执行存量撤销。
- 测试命令 + 真实输出: V-B，exit=0；这些成功只证明新路径，不能作为存量已清理的证明。

```text
PASS test/f02-file-forward-auth.test.js
  ✓ historical planted message cannot be forwarded into a download authorization (9 ms)
  ✓ removed original member cannot plant or forward using a historical URL (4 ms)
  ✓ parallel permitted forwarding is atomic and share uniqueness survives retries (12 ms)
  ✓ membership revoked in original conversation before queued grant commits is rejected (3 ms)
  ✓ membership revoked in destination conversation before queued grant commits is rejected (2 ms)
```

- 当前状态: MITIGATED

### R-3 / §2-1 / §4：401 刷新对普通写请求的回归

- 处理方式: 已修
- 改动文件: web/src/utils/axiosInterceptor.js；web/src/utils/f06-axios-retry.test.js。
- 新增/修改的测试: 新增未设 skipRetry 的 GET/POST/PUT/PATCH/DELETE：401→refresh→原请求一次重放；新增 GET/POST skipRetry 拒绝成对用例，保留资金 opt-out、所有写方法 5xx/超时不重放、读方法恢复/上限/取消测试。
- 技术依据/边界: axiosInterceptor.js:169–176 去掉 401 分支的方法限制，保留 skipRetry、取消和单次 _retry 守卫。middleware/auth.js:21/35/49 的 401 在业务执行前返回；这与已执行后 5xx/超时的未知结果不同。shouldRetry:95–100 仍仅放行读方法，资金弹窗仍显式 skipRetry。原报告“普通写请求必须封禁 401 才能安全”的说法不成立，以本轮更正为准。
- 测试命令 + 真实输出: V-W，exit=0。

```text
 ✓ src/utils/axiosSessionRefresh.test.js (11 tests) 96ms
 ✓ src/utils/f06-axios-retry.test.js (26 tests) 185ms
 ✓ src/contexts/AuthSession.test.jsx (29 tests) 256ms
 ✓ src/utils/uploadFallback.test.js (1 test) 23ms
 ✓ src/components/f06-financial-modals.test.jsx (2 tests) 63ms
 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  2.56s (transform 1.47s, setup 0ms, import 4.46s, tests 623ms, environment 1ms)
```

- 当前状态: VERIFIED

### R-4 / §1 F-06 差异 3：refresh POST 的重试策略

- 处理方式: 部分修（不重放一次性 refresh；修复瞬态失败直接清除 Bearer 凭据）
- 改动文件: web/src/utils/axiosInterceptor.js；web/src/utils/f06-axios-retry.test.js。
- 新增/修改的测试: 503/无响应时 refresh 只调用一次并保留 token/default Authorization；确定 401 时清除；保留既有 session 切换与跨标签页回归。
- 技术依据/边界: 不认同直接恢复 refresh 的 5xx/网络自动重放：auth.controller.js:79–89 先生成新 token，再将旧 token 拉黑，随后才写响应；响应丢失时再次提交旧 token 并不幂等。依据此服务端实现，本轮保留 POST 不自动重放；axiosInterceptor.js:77 改为仅 401/403 明确拒绝时清除本地凭据，避免一次瞬态错误就删除仍可能有效的凭据。若服务器已完成轮换但新凭据丢失，旧 token 无法恢复，仍可能需要重新登录；没有声称解决这个协议边界。
- 测试命令 + 真实输出: V-W，exit=0。

```text
 ✓ src/utils/axiosSessionRefresh.test.js (11 tests) 96ms
 ✓ src/utils/f06-axios-retry.test.js (26 tests) 185ms
 ✓ src/contexts/AuthSession.test.jsx (29 tests) 256ms
 ✓ src/utils/uploadFallback.test.js (1 test) 23ms
 ✓ src/components/f06-financial-modals.test.jsx (2 tests) 63ms
 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  2.56s (transform 1.47s, setup 0ms, import 4.46s, tests 623ms, environment 1ms)
```

- 当前状态: MITIGATED

### R-5：旧 WebView 缺少 crypto.randomUUID

- 处理方式: 已修
- 改动文件: web/src/utils/financialRequest.js；web/src/utils/f06-axios-retry.test.js。
- 新增/修改的测试: 移除测试环境的 randomUUID，保留真实 getRandomValues：key 为 32 位十六进制，同意图复用、不同 payload 不同 key。
- 技术依据/边界: financialRequest.js:3–7 使用 Web Crypto 随机字节回退，满足后端 16–128 字符格式，不采用低熵 Math.random。前提仍是运行环境具备 getRandomValues；本轮没有真实旧 WebView 设备验收，也不自行实现伪随机降级。
- 测试命令 + 真实输出: V-W，exit=0。

```text
 ✓ src/utils/axiosSessionRefresh.test.js (11 tests) 96ms
 ✓ src/utils/f06-axios-retry.test.js (26 tests) 185ms
 ✓ src/contexts/AuthSession.test.jsx (29 tests) 256ms
 ✓ src/utils/uploadFallback.test.js (1 test) 23ms
 ✓ src/components/f06-financial-modals.test.jsx (2 tests) 63ms
 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  2.56s (transform 1.47s, setup 0ms, import 4.46s, tests 623ms, environment 1ms)
```

- 当前状态: VERIFIED

### §3 缺测 / §4 F-06：红包、幂等键复用、账本与广播

- 处理方式: 已修
- 改动文件: backend-v2/test/f06-financial-idempotency.test.js；backend-v2/test/fixtures/f06-financial-process.cjs。
- 新增/修改的测试: 补转账同 key 换收款人；红包同 key 换金额/个数/祝福语/会话 409；红包双进程竞争和提交前/后 SIGKILL；转账和红包重放后消息/红包/流水/事件精确增量及 broadcaster.broadcastMessage 恰一次。
- 技术依据/边界: 额外核实 /api/messages/red-packet/send 与 /api/redpackets/send 引用同一 controller（messages.routes.js:21/1210、redpackets.routes.js:37），controller:8 均传同一 Idempotency-Key。新增主路由成功后从旧路由重放返回同体、换会话 409 的用例，因此别名路由不能复用 key 重复扣款。全仓资金写调用无 WebSocket 旁路。子进程只串行初始化 schema，两个 ready 子进程同时收到操作请求，真实竞争 IMMEDIATE 事务；提交前崩溃零副作用、提交后重试维持一笔。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f06-financial-idempotency.test.js (7.026 s)
  ✓ transfer committed with a lost response then retried concurrently only debits once (87 ms)
  ✓ redpacket committed with a lost response then retried concurrently only debits once (50 ms)
  ✓ same key with changed payload is rejected, preserving the original result (57 ms)
  ✓ same transfer key cannot be reused with another recipient (29 ms)
  ✓ redpacket same key rejects changed payload {"totalAmount":11} (22 ms)
  ✓ redpacket same key rejects changed payload {"totalCount":2} (33 ms)
  ✓ redpacket same key rejects changed payload {"greeting":"changed"} (15 ms)
  ✓ legacy redpacket route shares the same idempotency namespace and rejects changed conversation (23 ms)
  ✓ key is scoped by actor and operation; old clients without a key remain supported (24 ms)
  ✓ invalid idempotency key is rejected before any debit (8 ms)
  ✓ failure after ledger writes rolls back both ledger and idempotency record; retry succeeds (40 ms)
  ✓ two actual processes racing on one key commit exactly one transfer (491 ms)
  ✓ two actual processes racing on one key commit exactly one redpacket (429 ms)
  ✓ transfer SIGKILL beforeCommit preserves atomicity and retry after restart is safe (189 ms)
  ✓ transfer SIGKILL afterCommit preserves atomicity and retry after restart is safe (183 ms)
  ✓ redpacket SIGKILL beforeCommit preserves atomicity and retry after restart is safe (216 ms)
  ✓ redpacket SIGKILL afterCommit preserves atomicity and retry after restart is safe (251 ms)
  ✓ standalone migration is idempotent and matches the startup migration (3 ms)
```

- 当前状态: VERIFIED

### §4 F-06：辅助函数测试不足，两个弹窗必须实际调用

- 处理方式: 已修（增加组件提交回调测试，不删除已有有效测试）
- 改动文件: web/src/components/f06-financial-modals.test.jsx。
- 新增/修改的测试: 直接执行两个生产组件，操作其返回元素的输入 onChange 和按钮 onClick：无效输入不发送、同一渲染闭包连续双击只发一次、失败显示错误且不关闭、手动重试/凭据刷新复用 key、改金额/账号换 key、成功仅通知和关闭一次。
- 技术依据/边界: 组件测试只控制 React hooks 的调度并保留跨渲染状态/refs，使用真实 Axios adapter 和真实拦截器；不 mock createFinancialRequest、send 或 inFlight，不是仅测辅助函数。它不是浏览器 DOM/焦点测试。另在 /tmp 的源代码副本中仅移除两个组件的 inFlight 守卫，两个测试实际变红（出现两次请求），证明用例能发现该行为缺失；工作树中的守卫未删除。
- 测试命令 + 真实输出: V-W，exit=0；V-X（临时副本负向校验，命令见下），exit=1 为预期。

```text
 ✓ src/utils/axiosSessionRefresh.test.js (11 tests) 96ms
 ✓ src/utils/f06-axios-retry.test.js (26 tests) 185ms
 ✓ src/contexts/AuthSession.test.jsx (29 tests) 256ms
 ✓ src/utils/uploadFallback.test.js (1 test) 23ms
 ✓ src/components/f06-financial-modals.test.jsx (2 tests) 63ms
 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  2.56s (transform 1.47s, setup 0ms, import 4.46s, tests 623ms, environment 1ms)

临时副本负向输出：
AssertionError: expected [ { config: { …(21) }, …(2) }, …(1) ] to have a length of 1 but got 2
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

- 当前状态: VERIFIED

### §1 F-06 残留 1/2/3/4：旧客户端、原生端、前置校验、余额快照

- 处理方式: 部分修（逐条确认边界；本轮不扩展原生端或改写业务校验）
- 改动文件: 无额外业务文件变更；既有 F-06 测试覆盖旧客户端无 key 可用与 actor/operation 隔离。
- 新增/修改的测试: 保留无 key 请求兼容、非法 key 拒绝、同 key 跨用户/操作隔离及持久结果重放。
- 技术依据/边界: 残留 1：financialIdempotency.js:15/24 仅在 key 非空时查询/保存结果；旧客户端无 key 的重复请求仍可能重复扣款。残留 2：只读 rg 检查原生端没有 Idempotency-Key；Android AppModule.kt:75–85 的 OkHttp builder 未显式设置 retryOnConnectionFailure，不能据此宣称底层绝无重试；iOS APIClient.swift:69 直接调用 URLSession 且未实现业务自动重放，但系统传输行为未实测。原生端不在审计原文的 Web 修复范围。残留 3：wallet.service.js:71–89 和 redpackets.service.js:15–38 的实时前置校验仍早于幂等查询，条件变化可使旧成功操作的重放得到 4xx；不会再次记账。残留 4：financialIdempotency:20 返回已保存 JSON，balance 自然是首次执行快照，客户端要最新余额应走余额查询。这些边界不能当成重复扣款已经对所有客户端根除。
- 测试命令 + 真实输出: V-B，exit=0；原生端仅静态核对，没有声称设备测试通过。

```text
PASS test/f06-financial-idempotency.test.js (7.026 s)
  ✓ transfer committed with a lost response then retried concurrently only debits once (87 ms)
  ✓ redpacket committed with a lost response then retried concurrently only debits once (50 ms)
  ✓ key is scoped by actor and operation; old clients without a key remain supported (24 ms)
  ✓ invalid idempotency key is rejected before any debit (8 ms)
```

- 当前状态: MITIGATED

### §2-4：删除重复 server_sequence 赋值

- 处理方式: 不认同属于功能回归（与复审的“行为等价”判断一致）
- 改动文件: 本轮不改 backend-v2/src/modules/wallet/wallet.service.js。
- 新增/修改的测试: 转账消息持久化、相同响应重放与会话事件增量测试通过。
- 技术依据/边界: wallet.service.js:107–111 插入消息时已传入 sequence，随后 SELECT m.* 读回同一字段；重复 msg.server_sequence = serverSequence 没有新增语义。恢复冗余赋值不能修复任何复审问题，故不为了迎合范围意见再改动它。
- 测试命令 + 真实输出: V-B，exit=0。

```text
PASS test/f06-financial-idempotency.test.js (7.026 s)
  ✓ transfer committed with a lost response then retried concurrently only debits once (87 ms)
  ✓ two actual processes racing on one key commit exactly one transfer (491 ms)
  ✓ transfer SIGKILL beforeCommit preserves atomicity and retry after restart is safe (189 ms)
  ✓ transfer SIGKILL afterCommit preserves atomicity and retry after restart is safe (183 ms)
```

- 当前状态: VERIFIED

### §2-5 / §3 调用方 / §4 全部测试质量项的归属核对

- 处理方式: 已修（完成范围与测试归属核对）
- 改动文件: 本轮共 15 个修改/新增路径；相对原审计基线最终 28 个路径，全部列在末尾归属表。
- 新增/修改的测试: F-01 默认发现、F-03 拒绝审计、F-02 真实 Socket 门禁与允许/拒绝、F-06 401 成对/组件回调/副作用计数逐项已有对应记录；所有旧用例保留或扩展为参数化用例，没有删除测试或降低断言。
- 技术依据/边界: 未改 package.json、lock、品牌、UI 样式、生产部署配置或新增数据库迁移；仅为复审要求的真实 Nginx 默认门禁修改 .github/workflows/ci.yml，归属 F-01。资金服务可选参数签名保持；startExpiryReclaim 定时任务不调用新增发送参数；auth/admin/shared 仅 require 资金模块的路径不受影响。CORS 没有 allowedHeaders 白名单，未新增自定义头预检限制。真实网络块独立标 BLOCKED，不能用 handler 夹具或其它环境复审结果抵销。
- 测试命令 + 真实输出: V-B、V-W、V-M、V-C、V-E 均 exit=0；git diff --check、node --check 均 exit=0。

```text
PASS test/f06-financial-idempotency.test.js (7.026 s)
PASS test/f02-file-forward-auth.test.js
PASS test/f03-clear-role.test.js
PASS test/f01-proxy-handshake.test.js
PASS test/p0-schema-drift.test.js
Test Suites: 5 passed, 5 total
Tests:       62 passed, 62 total
Snapshots:   0 total
Time:        14.239 s

 ✓ src/utils/axiosSessionRefresh.test.js (11 tests) 96ms
 ✓ src/utils/f06-axios-retry.test.js (26 tests) 185ms
 ✓ src/contexts/AuthSession.test.jsx (29 tests) 256ms
 ✓ src/utils/uploadFallback.test.js (1 test) 23ms
 ✓ src/components/f06-financial-modals.test.jsx (2 tests) 63ms
 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  2.56s (transform 1.47s, setup 0ms, import 4.46s, tests 623ms, environment 1ms)

✅ migrations 数组合规: 前 154 条与 base 完全一致, 尾部追加 1 条 (154 → 155)
(!) outDir /tmp/touliao-batch1-round2-web-build is not inside project root and will not be emptied.
✓ built in 1.56s
```

- 当前状态: VERIFIED

### 验证命令与真实输出

以下均为本轮已实际执行的命令；日志名相对 /tmp/touliao-batch1-round2-evidence。

V-B：backend-final.log，exit=0。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose test/f01-proxy-handshake.test.js test/f03-clear-role.test.js test/f02-file-forward-auth.test.js test/f06-financial-idempotency.test.js test/p0-schema-drift.test.js
```

```text
PASS test/f06-financial-idempotency.test.js (7.026 s)
PASS test/f02-file-forward-auth.test.js
PASS test/f03-clear-role.test.js
PASS test/f01-proxy-handshake.test.js
PASS test/p0-schema-drift.test.js
Test Suites: 5 passed, 5 total
Tests:       62 passed, 62 total
Snapshots:   0 total
Time:        14.239 s
```

V-W：web-final.log，exit=0。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/web
env -i PATH="$PATH" NO_COLOR=1 node node_modules/.bin/vitest run --configLoader native --no-cache src/utils/f06-axios-retry.test.js src/components/f06-financial-modals.test.jsx src/utils/axiosSessionRefresh.test.js src/utils/uploadFallback.test.js src/contexts/AuthSession.test.jsx
```

```text
 ✓ src/utils/axiosSessionRefresh.test.js (11 tests) 96ms
 ✓ src/utils/f06-axios-retry.test.js (26 tests) 185ms
 ✓ src/contexts/AuthSession.test.jsx (29 tests) 256ms
 ✓ src/utils/uploadFallback.test.js (1 test) 23ms
 ✓ src/components/f06-financial-modals.test.jsx (2 tests) 63ms
 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  2.56s (transform 1.47s, setup 0ms, import 4.46s, tests 623ms, environment 1ms)
```

V-L：live-final.log，exit=1。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose test/f01-proxy-handshake.test.js test/f01-proxy-handshake.live.test.js test/f02-file-socket.live.test.js
```

```text
listen EPERM: operation not permitted 127.0.0.1
FAIL test/f02-file-socket.live.test.js
FAIL test/f01-proxy-handshake.live.test.js
PASS test/f01-proxy-handshake.test.js
Test Suites: 2 failed, 1 passed, 3 total
Tests:       8 failed, 10 passed, 18 total
Time:        5.47 s, estimated 6 s
```

V-N：backend-network-regression.log，exit=1。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose test/chat-files.test.js test/forward-multi.test.js test/p1-06-clear-resurrection.test.js
```

```text
Error: listen EPERM: operation not permitted 0.0.0.0
  code: 'EPERM',
  syscall: 'listen',
  address: '0.0.0.0'
```

V-D：jest-discovery.log，exit=0。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" node node_modules/jest/bin/jest.js --listTests --runInBand
```

```text
/home/ubuntu/touliao-fix-wt-20260920/backend-v2/test/f02-file-socket.live.test.js
/home/ubuntu/touliao-fix-wt-20260920/backend-v2/test/f01-proxy-handshake.live.test.js
```

V-M：migration.log，exit=0。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920
git show 45dccd9963cad8dec00ef8d13019207491016fb4:backend-v2/src/db/schema.js > /tmp/touliao-batch1-round2-baseline-schema.js
env -i PATH="$PATH" node backend-v2/scripts/check-migration-append.js --base-file /tmp/touliao-batch1-round2-baseline-schema.js
```

```text
✅ migrations 数组合规: 前 154 条与 base 完全一致, 尾部追加 1 条 (154 → 155)
```

V-C：web-build.log，exit=0。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/web
env -i PATH="$PATH" NO_COLOR=1 node node_modules/vite/bin/vite.js build --configLoader native --outDir /tmp/touliao-batch1-round2-web-build
```

```text
(!) outDir /tmp/touliao-batch1-round2-web-build is not inside project root and will not be emptied.
✓ built in 1.56s
```

V-E：web-lint.log，exit=0。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/web
env -i PATH="$PATH" NO_COLOR=1 node node_modules/eslint/bin/eslint.js src/utils/axiosInterceptor.js src/utils/financialRequest.js src/utils/f06-axios-retry.test.js src/components/f06-financial-modals.test.jsx --max-warnings=0
```

```text
（stdout/stderr 无输出）
```

V-N 的旧网络回归在 supertest 监听 0.0.0.0 时触发未处理 EPERM，Node 提前退出，未形成有效测试数量汇总；不能把三个文件视为跑完。V-L 所有 8 个 live 用例均被 beforeAll 监听错误阻断；同时运行的 10 个 F-01 中间件用例通过，没有用户夹具主键冲突。V-E 空输出是实际 exit=0。V-C 的 outDir 提示是使用隔离 /tmp 产物目录的正常提示，不是部署。

V-X：只在 /tmp/touliao-round2-modal-negative-g23pqxms 中复制 Web 源码与配置，并把两个组件的 ` || inFlight.current` 删除；node_modules 只读链接，工作树文件未改。实际命令及输出：

```bash
task_copy=$(cat /tmp/touliao-batch1-round2-evidence/modal-negative-path.txt)
cd "$task_copy"
env -i PATH="$PATH" NO_COLOR=1 node node_modules/.bin/vitest run --config vitest.config.mjs --configLoader native --no-cache src/components/f06-financial-modals.test.jsx
```

```text
AssertionError: expected [ { config: { …(21) }, …(2) }, …(1) ] to have a length of 1 but got 2
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

本轮失败和修正过程也保留：backend-initial.log 为 2 failed / 55 passed，分别是资金夹具并发启动未到 ready 触发超时、红包 controller 外层 success 与服务持久结果形状不同。夹具改为初始化后同时发操作、ready 前退出立刻报错且清理自建子进程；崩溃重放比较包含真实 controller 外层 success。随后扩展并通过最终 62 项，没有调整超时、跳过测试或放松扣款/消息/流水/授权断言。sticker-bypass-before.log 的 3 failed / 17 passed 是新发现的 HTTP 表情发送授权缺口与缺少事务 share 的真实失败；修后相关 3 项均通过。web-initial.log 为 38 passed；web-components-initial.log 为 2 passed。

最后核对：与返修起点相比，业务变更仅为公开表情/头像例外、共用文件发送授权、不可重试失败分类、401 刷新恢复、瞬态 refresh 失败保留凭据、UUID 回退；其它变更均是对应测试与 CI。F-02 严格二次转发/历史未登记 CDN、旧授权污染、F-01 容量/分布式限流、无 key 旧客户端，以及真实网络环境验证仍是明确遗留边界。未开始下一批。


## 文件归属(机器可读·返修后最终版)

F-01: backend-v2/src/realtime/index.js, backend-v2/test/f01-proxy-handshake.test.js, backend-v2/test/f01-proxy-handshake.live.cjs, backend-v2/test/f01-proxy-handshake.live.test.js, .github/workflows/ci.yml
F-03: backend-v2/src/modules/conversations/conversations.service.js, backend-v2/test/f03-clear-role.test.js
F-02: backend-v2/src/utils/fileRegistry.js, backend-v2/src/realtime/handlers/file.js, backend-v2/src/modules/messages/messages.service.js, backend-v2/test/f02-file-forward-auth.test.js, backend-v2/test/f02-inprocess-http.cjs, backend-v2/test/f02-file-socket.live.test.js
F-06: backend-v2/src/db/schema.js, backend-v2/src/db/migrations/f06-financial-idempotency.sql, backend-v2/src/modules/wallet/financialIdempotency.js, backend-v2/src/modules/wallet/wallet.controller.js, backend-v2/src/modules/wallet/wallet.service.js, backend-v2/src/modules/redpackets/redpackets.controller.js, backend-v2/src/modules/redpackets/redpackets.service.js, backend-v2/test/f06-financial-idempotency.test.js, backend-v2/test/fixtures/f06-financial-process.cjs, web/src/utils/axiosInterceptor.js, web/src/utils/financialRequest.js, web/src/components/TransferModal.jsx, web/src/components/RedPacketModal.jsx, web/src/utils/f06-axios-retry.test.js, web/src/components/f06-financial-modals.test.jsx
RESIDUAL: none


## 返修记录(第 3 轮 · 只修 N-1 / N-2)

日期：2026-09-20（UTC）。本轮起始工作树干净。只修 N-1、N-2，并按 N-2 要求排查批次 1 新增 live/集成测试的同类夹具和前置条件问题；没有开始批次 2。

路径假设：遵守“只在 `/home/ubuntu/touliao-fix-wt-20260920` 内改动”的边界，将输入报告原文完整复制到该工作树的 `BATCH1_FIX_REPORT.md`，在副本末尾追加本节；没有写回工作树外的输入报告。此前历史记录保留原文，本轮判断以本节为准，尤其纠正此前将 F-02 夹具失败也归因于监听权限的错误说明。

验证环境：全部测试使用清空的环境变量、Jest testEnv 指定的工作树内 `.tmp-test-db.sqlite` / `.tmp-test-uploads` 及合成账号；临时目录也设在工作树内。未连接生产库、生产账号、支付或推送服务，未打印真实密钥。没有执行任何 git 提交、push、merge、tag，也没有部署或修改主仓库。原始最终日志、复跑脚本、负向对照和夹具核查脚本位于 [batch1-round3-evidence](batch1-round3-evidence/)。

### N-1

- 处理：把“只有发生写入失败才可重试”的条件改为排除三种已有权限失败原因：`无权转发该消息`、`无权转发该附件`、`没有可用的目标会话`。缺失/不支持类型的源消息及普通写入失败恢复原有 retryable 语义。没有放宽源会话、附件或目标会话授权检查，也没有改变批次持久化/重放流程。
- 改动文件：`backend-v2/src/modules/messages/messages.service.js`；`backend-v2/test/f02-file-forward-auth.test.js`（新增 4 项：三种权限拒绝与缺失消息混合、同批次重放、不支持类型）。`message-sync.test.js` 第 207 行及其它既有期望完全未改。`ForwardModal.jsx` 未改：缺失消息恢复触发重试提示，纯权限拒绝不触发。
- 测试命令 + 真实输出：正式命令 B-SYNC 在当前沙箱先触发监听错误并退出，不能称为正式网络测试通过：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --runTestsByPath test/message-sync.test.js
```

```text
Error: listen EPERM: operation not permitted 0.0.0.0
  code: 'EPERM',
  syscall: 'listen',
  address: '0.0.0.0'
```

exit=1，Node 在 beforeAll 注册用户时退出，没有有效 Jest 数量汇总。日志：[message-sync-standard.log](batch1-round3-evidence/message-sync-standard.log)。

为补充代码层证据，使用 `--setupFilesAfterEnv .../inprocess-supertest.cjs` 仅将 HTTP 传输改为进程内送入真实 Express。保留 Supertest 的请求构造/断言、原测试文件、注册/鉴权、业务服务及 SQLite/worker；上传仍走真实 multipart、multer、魔数、落盘和缩略图处理。该适配器只用于四份旧 HTTP 回归，不用于 Socket.IO/nginx live，也不代表网络链路已验收。

负向对照命令：临时将本轮 predicate 替换回旧条件，跑原 `message-sync.test.js` 全 13 项，在 finally 恢复最终文件，再以同一命令复跑；没有修改测试断言。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920
python3 batch1-round3-evidence/check-n1-negative.py
```

```text
n1-negative: exit=1
message-sync-inprocess-final: exit=0
Negative control detected N-1; final source restored; original message-sync assertions pass.
```

旧过滤条件真实失败输出（[n1-negative.log](batch1-round3-evidence/n1-negative.log)）：

```text
● 统一消息同步游标 › 批量转发失败项明确返回且不伪装成全部成功

    expect(received).toContain(expected) // indexOf

    Expected value: "missing-1789913568418"
    Received array: []

      205 |     expect(response.body.failed_count).toBe(1);
      206 |     expect(response.body.failed_message_ids).toContain(invalidId);
    > 207 |     expect(response.body.retryable_message_ids).toContain(invalidId);
          |                                                 ^
      208 |   });
      209 | });
      210 |

      at Object.toContain (test/message-sync.test.js:207:49)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 12 passed, 13 total
Snapshots:   0 total
Time:        6.826 s
```

恢复修复后的单文件命令及真实输出（[message-sync-inprocess-final.log](batch1-round3-evidence/message-sync-inprocess-final.log)）：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --setupFilesAfterEnv /home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/inprocess-supertest.cjs --runTestsByPath test/message-sync.test.js
```

```text
PASS test/message-sync.test.js (6.128 s)
  统一消息同步游标
    ✓ 同一会话并发追加事件获得严格递增且唯一的 server_sequence (26 ms)
    ✓ cursor 分页可完整恢复 1 个事件 (24 ms)
    ✓ cursor 分页可完整恢复 10 个事件 (9 ms)
    ✓ cursor 分页可完整恢复 100 个事件 (19 ms)
    ✓ cursor 分页可完整恢复 1000 个事件 (87 ms)
    ✓ cursor 分页可完整恢复 10000 个事件 (797 ms)
    ✓ 重复拉取同一 cursor 返回相同事件且不产生新数据 (14 ms)
    ✓ 个人删除事件只对目标账号可见，但其他设备游标仍推进到高水位 (16 ms)
    ✓ 发送、编辑、撤回共用同一严格递增事件流 (36 ms)
    ✓ 清空会话是双向的：旧 cursor 补拉到的 message_created 内容已被真实清空，双方都看不到 (34 ms)
    ✓ 钱包转账提交后发出同步失效提示 (6 ms)
    ✓ 批量转发返回批次结果并支持 client_batch_id 幂等重试 (103 ms)
    ✓ 批量转发失败项明确返回且不伪装成全部成功 (50 ms)

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
Snapshots:   0 total
Time:        6.227 s, estimated 7 s
```

新增权限分类保护在下方 B-CORE 运行中的真实输出：

```text
  ✓ missing source stays retryable alongside a source permission denial, including batch replay (4 ms)
  ✓ missing source stays retryable alongside a attachment permission denial, including batch replay (5 ms)
  ✓ missing source stays retryable alongside a target permission denial, including batch replay (6 ms)
  ✓ unsupported source type retains the existing non-permission retry hint (4 ms)
```

- 状态：**VERIFIED（原断言在进程内 HTTP 补充运行恢复 13/13 绿；正式 TCP 命令仍受环境限制）**。负向对照能重新发现第 207 行错误，最终修复已恢复并验证。无需更改测试期望或请求产品改变 retryable 语义。

### N-2

- 处理：F-02 live 的 messages INSERT 增加 `content` 列，并传入合成文本 `synthetic live file`。原 3 个 live 用例及断言均保留，没有 mock 掉 Socket 传输、添加 skip 或调大超时。此前失败首先来自该 NOT NULL 缺陷，不能归为 EPERM；本轮修后正式运行已走过该插入，实际在后续 `server.listen` 处报 EPERM。
- 同类检查：依据本仓库 applySchema 在内存 SQLite 建表，按 `PRAGMA table_info` 核查批次 1 新增的 9 个测试/共享夹具文件中的显式 INSERT 是否漏掉无默认值的 NOT NULL 列。旧版 F-02 精确检出 `messages.content`，当前未发现其它遗漏。F-03、F-02 非 live、F-06 真实多进程集成还实际运行通过。F-01 live 的 nginx 前置条件缺少明确诊断，因此增加可执行检查、子进程启动/提前退出错误处理，并在清理时排除未启动/已终止的进程；仍明确失败而非跳过，不改变默认门禁依赖政策。现有 Jest testEnv 隔离配置、F-06 子进程测试库前置判断保留。
- 改动文件：`backend-v2/test/f02-file-socket.live.test.js`；`backend-v2/test/f01-proxy-handshake.live.cjs`（N-2 同类前置条件检查）。证据脚本 `batch1-round3-evidence/check-fixtures.cjs` 及保存的旧夹具 `f02-file-socket.before.cjs` 仅用于核查，不在默认 Jest testMatch 中。
- 测试命令 + 真实输出（B-F02-LIVE，exit=1）：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --runTestsByPath test/f02-file-socket.live.test.js
```

```text
FAIL test/f02-file-socket.live.test.js
  ✕ real unauthenticated socket is rejected (1 ms)
  ✕ real socket planting is denied and the private download stays denied
  ✕ real owner socket commits one message and grant, then recipient can download

  ● real unauthenticated socket is rejected

    listen EPERM: operation not permitted 127.0.0.1


  ● real socket planting is denied and the private download stays denied

    listen EPERM: operation not permitted 127.0.0.1


  ● real owner socket commits one message and grant, then recipient can download

    listen EPERM: operation not permitted 127.0.0.1


Test Suites: 1 failed, 1 total
Tests:       3 failed, 3 total
Snapshots:   0 total
Time:        4.761 s
```

完整日志：[f02-file-socket.live-standard.log](batch1-round3-evidence/f02-file-socket.live-standard.log)。当前运行仍有 **3 个用例在 beforeAll 被监听权限阻断，Socket 用例断言执行数为 0**；这次没有 `messages.content` 约束错误。最小 `net.createServer().listen(0, '127.0.0.1')` 探针也得到 `LOOPBACK_LISTEN_FAILED: EPERM listen EPERM: operation not permitted 127.0.0.1`。当前权限配置禁止提权，也没有可用的允许监听的执行环境；没有尝试绕过沙箱。

夹具检查替代证据（内存库，不访问任何业务数据库）：

```bash
cd /home/ubuntu/touliao-fix-wt-20260920
git show HEAD:backend-v2/test/f02-file-socket.live.test.js > batch1-round3-evidence/f02-file-socket.before.cjs
env -i PATH="$PATH" node batch1-round3-evidence/check-fixtures.cjs
```

```text
BEFORE: f02-file-socket.live.test.js missing messages.content
AFTER: f01-proxy-handshake.test.js: no omitted NOT NULL columns without defaults
AFTER: f01-proxy-handshake.live.test.js: no omitted NOT NULL columns without defaults
AFTER: f01-proxy-handshake.live.cjs: no omitted NOT NULL columns without defaults
AFTER: f02-file-forward-auth.test.js: no omitted NOT NULL columns without defaults
AFTER: f02-file-socket.live.test.js: no omitted NOT NULL columns without defaults
AFTER: f02-inprocess-http.cjs: no omitted NOT NULL columns without defaults
AFTER: f03-clear-role.test.js: no omitted NOT NULL columns without defaults
AFTER: f06-financial-idempotency.test.js: no omitted NOT NULL columns without defaults
AFTER: fixtures/f06-financial-process.cjs: no omitted NOT NULL columns without defaults
Fixture column audit: 9 files checked; baseline defect reproduced; current omissions=0
```

该检查只证明显式 INSERT 列与 schema 一致，不能替代真实 Socket 断言。B-CORE 的 `f02-file-forward-auth.test.js` 25/25 进一步覆盖实际 handler/服务/鉴权/事务的允许与拒绝，但也不能将 live 标为通过。

- 状态：**FIXED_UNVERIFIED / BLOCKED_ENV（夹具已修；真实 Socket 3/3 通过尚未取得）**。需在允许回环监听的隔离环境运行上面的 B-F02-LIVE，确认全部断言执行并通过；F-01 nginx live 同样须实跑。当前不能宣称本批默认 Jest/CI 全绿，也没有触发远端 CI。

## 回归复跑清单(第 3 轮)

下表按文件列结果；命令编号对应本节后面的完整实跑命令，合并命令中的逐文件数量按真实 verbose 输出统计。四份旧 HTTP 回归正式命令都单独执行过，均因 `0.0.0.0` 监听 EPERM 提前退出（exit=1，无 Jest 有效总数）；B-HTTP 是它们的补充运行。live 两份保持正式传输。

| 测试文件 | 测试命令 | 真实结果 |
|---|---|---|
| `backend-v2/test/message-sync.test.js` | B-SYNC；B-HTTP；N-1 单文件对照命令 | 正式 EPERM；补充 13/13 通过；旧 predicate 1 失败/12 通过，恢复修复后 13/13 通过 |
| `backend-v2/test/forward-multi.test.js` | B-FORWARD；B-HTTP | 正式 EPERM；补充 3/3 通过 |
| `backend-v2/test/chat-files.test.js` | B-FILES；B-HTTP | 正式 EPERM；补充 7/7 通过 |
| `backend-v2/test/p1-02-uploads-idor.test.js` | B-IDOR；B-HTTP | 正式 EPERM；补充 16/16 通过，含真实 multipart/落盘/缩略图 |
| `backend-v2/test/f01-proxy-handshake.test.js` | B-CORE | 10/10 通过 |
| `backend-v2/test/f01-proxy-handshake.live.test.js`（引入 `.live.cjs`） | B-F01-LIVE | 5/5 因 beforeAll 的 127.0.0.1 监听 EPERM 失败，断言未执行 |
| `backend-v2/test/f02-file-forward-auth.test.js` | B-CORE | 25/25 通过，含本轮新增 4 项 |
| `backend-v2/test/f02-file-socket.live.test.js` | B-F02-LIVE | 3/3 因 beforeAll 的 127.0.0.1 监听 EPERM 失败，断言未执行 |
| `backend-v2/test/f03-clear-role.test.js` | B-CORE | 7/7 通过 |
| `backend-v2/test/f06-financial-idempotency.test.js`（含 process fixture） | B-CORE | 18/18 通过，含真实双进程与 SIGKILL 前后提交测试 |
| `backend-v2/test/p0-schema-drift.test.js` | B-CORE | 6/6 通过 |
| `web/src/utils/f06-axios-retry.test.js` | W-F06 | 26/26 通过 |
| `web/src/components/f06-financial-modals.test.jsx` | W-F06 | 2/2 通过 |
| `web/src/utils/axiosSessionRefresh.test.js` | W-F06 | 11/11 通过 |
| `web/src/utils/uploadFallback.test.js` | W-F06 | 1/1 通过 |
| `web/src/contexts/AuthSession.test.jsx` | W-F06 | 29/29 通过 |

B-SYNC、B-F02-LIVE 的完整命令见上。其余命令及输出如下；全部工作目录和参数也保存在 `batch1-round3-evidence/results.json`，批量复跑入口为 `python3 batch1-round3-evidence/run-regressions.py`。

B-FORWARD：exit=1，日志 [forward-multi-standard.log](batch1-round3-evidence/forward-multi-standard.log)。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --runTestsByPath test/forward-multi.test.js
```

```text
Error: listen EPERM: operation not permitted 0.0.0.0
```

B-FILES：exit=1，日志 [chat-files-standard.log](batch1-round3-evidence/chat-files-standard.log)。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --runTestsByPath test/chat-files.test.js
```

```text
Error: listen EPERM: operation not permitted 0.0.0.0
```

B-IDOR：exit=1，日志 [p1-02-uploads-idor-standard.log](batch1-round3-evidence/p1-02-uploads-idor-standard.log)。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --runTestsByPath test/p1-02-uploads-idor.test.js
```

```text
Error: listen EPERM: operation not permitted 0.0.0.0
```

B-F01-LIVE：exit=1，日志 [f01-proxy-handshake.live-standard.log](batch1-round3-evidence/f01-proxy-handshake.live-standard.log)。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --runTestsByPath test/f01-proxy-handshake.live.test.js
```

```text
listen EPERM: operation not permitted 127.0.0.1
FAIL test/f01-proxy-handshake.live.test.js
Test Suites: 1 failed, 1 total
Tests:       5 failed, 5 total
Snapshots:   0 total
Time:        1.441 s
```

B-CORE：exit=0，日志 [backend-core.log](batch1-round3-evidence/backend-core.log)。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --runTestsByPath test/f01-proxy-handshake.test.js test/f03-clear-role.test.js test/f02-file-forward-auth.test.js test/f06-financial-idempotency.test.js test/p0-schema-drift.test.js
```

```text
PASS test/f02-file-forward-auth.test.js
PASS test/f06-financial-idempotency.test.js
PASS test/p0-schema-drift.test.js
PASS test/f03-clear-role.test.js
PASS test/f01-proxy-handshake.test.js
Test Suites: 5 passed, 5 total
Tests:       66 passed, 66 total
Snapshots:   0 total
Time:        15.768 s
```

B-HTTP：exit=0，日志 [backend-inprocess.log](batch1-round3-evidence/backend-inprocess.log)。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/backend-v2
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit --verbose --setupFilesAfterEnv /home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/inprocess-supertest.cjs --runTestsByPath test/message-sync.test.js test/forward-multi.test.js test/chat-files.test.js test/p1-02-uploads-idor.test.js
```

```text
PASS test/p1-02-uploads-idor.test.js (7.92 s)
PASS test/forward-multi.test.js
PASS test/message-sync.test.js
PASS test/chat-files.test.js
Test Suites: 4 passed, 4 total
Tests:       39 passed, 39 total
Snapshots:   0 total
Time:        21.316 s
```

W-F06：exit=0，日志 [web-f06.log](batch1-round3-evidence/web-f06.log)。

```bash
cd /home/ubuntu/touliao-fix-wt-20260920/web
env -i PATH="$PATH" TMPDIR=/home/ubuntu/touliao-fix-wt-20260920/batch1-round3-evidence/tmp NO_COLOR=1 node node_modules/.bin/vitest run --configLoader native --no-cache src/utils/f06-axios-retry.test.js src/components/f06-financial-modals.test.jsx src/utils/axiosSessionRefresh.test.js src/utils/uploadFallback.test.js src/contexts/AuthSession.test.jsx
```

```text
 ✓ src/utils/axiosSessionRefresh.test.js (11 tests) 72ms
 ✓ src/utils/f06-axios-retry.test.js (26 tests) 157ms
 ✓ src/contexts/AuthSession.test.jsx (29 tests) 107ms
 ✓ src/utils/uploadFallback.test.js (1 test) 33ms
 ✓ src/components/f06-financial-modals.test.jsx (2 tests) 83ms
 Test Files  5 passed (5)
      Tests  69 passed (69)
   Duration  1.50s (transform 655ms, setup 0ms, import 2.18s, tests 451ms, environment 2ms)
```

本轮验证过程中的适配器问题如实记录：首次 B-HTTP 为 1 failed/3 passed suites、16 failed/23 passed tests，上传在 beforeAll 返回 400；原因是补充传输未标记 HTTP 请求已完整接收。补齐 `req.complete=true` 后，以原四份测试原样复跑得到上面的 4 suites / 39 tests 通过。没有修改上传业务或既有期望。夹具检查脚本首次因 Node 同步启动 git 的 EPERM 退出，改为 shell 只读导出旧夹具后再读取文件，最终检查通过；最初诊断保留于 `fixture-audit-initial.log`。这些初次失败均未被算作通过。

收尾检查：`git diff --check`、4 个改动的 JS/CJS 文件与 2 个证据脚本的 `node --check`、四份既有回归及 `ForwardModal.jsx` 与 HEAD 的差异检查，全部 exit=0，详见 [final-checks.log](batch1-round3-evidence/final-checks.log)。Jest 沿用仓库的 `--forceExit`，没有宣称无残留应用级句柄。无依赖/版本/schema/资金逻辑/前端业务变更；未删测试、弱化断言或增加 skip。除 N-1/N-2 及明确要求的同类夹具修正外，其它已知风险维持原报告状态。

遗留待办：在允许监听的隔离环境取得 F-02 真实 Socket 3/3、F-01 nginx 5/5，以及四份旧 HTTP 正式传输回归的实际通过结果，并确认默认 Jest/CI。当前仅交付真实证据，不将上述环境阻断写为通过。已停止，不开始批次 2。

## 文件归属(机器可读·第 3 轮最终版)

F-01: backend-v2/src/realtime/index.js, backend-v2/test/f01-proxy-handshake.test.js, backend-v2/test/f01-proxy-handshake.live.cjs, backend-v2/test/f01-proxy-handshake.live.test.js, .github/workflows/ci.yml
F-03: backend-v2/src/modules/conversations/conversations.service.js, backend-v2/test/f03-clear-role.test.js
F-02: backend-v2/src/utils/fileRegistry.js, backend-v2/src/realtime/handlers/file.js, backend-v2/src/modules/messages/messages.service.js, backend-v2/test/f02-file-forward-auth.test.js, backend-v2/test/f02-inprocess-http.cjs, backend-v2/test/f02-file-socket.live.test.js, BATCH1_FIX_REPORT.md, batch1-round3-evidence/
F-06: backend-v2/src/db/schema.js, backend-v2/src/db/migrations/f06-financial-idempotency.sql, backend-v2/src/modules/wallet/financialIdempotency.js, backend-v2/src/modules/wallet/wallet.controller.js, backend-v2/src/modules/wallet/wallet.service.js, backend-v2/src/modules/redpackets/redpackets.controller.js, backend-v2/src/modules/redpackets/redpackets.service.js, backend-v2/test/f06-financial-idempotency.test.js, backend-v2/test/fixtures/f06-financial-process.cjs, web/src/utils/axiosInterceptor.js, web/src/utils/financialRequest.js, web/src/components/TransferModal.jsx, web/src/components/RedPacketModal.jsx, web/src/utils/f06-axios-retry.test.js, web/src/components/f06-financial-modals.test.jsx
RESIDUAL: none
