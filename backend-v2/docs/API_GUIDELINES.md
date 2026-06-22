# VXin v2 后端 API 规范（API_GUIDELINES）

**状态**: 生效中（P2 起作为**新接口**的强制约定）
**来源**: `API_REVIEW_20260622.md` §2 的落地版
**核心原则**: **向后兼容优先**。存量接口的契约（裸 JSON / 裸数组 / `{success:true}` / `{ok:true}`）**一律不改**；本规范只约束**新增**接口，并以「加法」方式增强存量错误响应。

> 为什么不推倒重来：`utils/http.js` 注释明确——响应结构与旧后端逐字一致是**有意为之的历史约束**，在线 Web/Electron 前端依赖它。规范必须渐进式引入，零破坏。

---

## 1. 响应结构

### 1.1 成功响应

| 场景 | 新接口约定 | Helper |
|------|-----------|--------|
| 单个资源 | 裸资源对象 `{ ...资源字段 }` | `res.json(payload)` |
| 创建资源 | `201` + 新资源对象 | `created(res, payload[, location])` |
| 删除 / 无返回体 | `204`，**无 body** | `noContent(res)` |
| 列表 | `{ items, total, hasMore }` | `paginated(rows, { total, limit, offset })` |

- **禁止再新增裸数组接口**。所有新列表走 `{ items, total, hasMore }`，前端可统一处理分页。
- 存量裸数组接口（如 `GET /moments`、`GET /messages/conversations`）维持原状，只可「加法」追加字段，不可改成信封。

### 1.2 失败响应（全局统一，已对存量生效）

由 `middleware/error.js` 统一输出，**双写**以兼容新旧前端：

```jsonc
{
  "error": "动态不存在",          // 中文文案，旧前端继续读
  "error_code": "MOMENT_NOT_FOUND" // 机器码，新前端按它分支（可国际化）
}
```

- 500 响应额外附 `request_id`，便于用户凭它定位日志（见 requestId 链路）。
- 未显式指定 code 的错误，由 `errorHandler` 按 HTTP 状态码兜底派生（见 `utils/errorCodes.js`），存量代码零改动即获得稳定 `error_code`。

---

## 2. HTTP 状态码约定

| 场景 | 状态码 |
|------|--------|
| 读取成功 | 200 |
| 创建成功 | **201**（响应体带新资源） |
| 更新成功 | 200 |
| 删除成功 / 无返回体 | **204** |
| 参数缺失 / 格式错误 | 400 |
| 语义校验失败 | 422 |
| 未认证 | 401 |
| 无权限 | 403 |
| 资源不存在 | 404 |
| 状态冲突（重复、并发） | **409** |
| 限流 | 429 |
| 服务端错误 | 500；依赖不可用 503 |

---

## 3. 错误码体系

- 集中定义在 `utils/errorCodes.js`，格式 `MODULE_REASON`，例：`AUTH_INVALID_CREDENTIALS`、`MOMENT_NOT_FOUND`、`COLLECTION_DUPLICATE`。
- 抛错统一用 `utils/http.js` 的工厂，需要细分语义时传第二参 `code`：

```js
const { conflict, notFound } = require('../../utils/http');
throw conflict('已收藏', 'COLLECTION_DUPLICATE'); // → 409 + error_code: COLLECTION_DUPLICATE
throw notFound('动态不存在', 'MOMENT_NOT_FOUND');  // → 404 + error_code: MOMENT_NOT_FOUND
```

- **业务异常一律 throw `ApiError`**（经上述工厂）。非 `ApiError` 视为未预期错误 → 500，进 winston `error.log`。

---

## 4. 命名规范

- 资源用复数名词、小写：`/moments`、`/collections`、`/conversations`。
- 路径参数在同一资源下统一 `:id`；跨资源引用才加前缀（`:userId`）。
- toggle 类动作式路由（如 `POST /moments/:id/like`）可保留，但须在评审中明确其语义。
- ⚠ **路由顺序**：静态路径（`/notifications`、`/search`）必须注册在 `/:id` 等动态段**之前**，否则被吞。

---

## 5. Helper 用法速查（`utils/http.js`）

```js
const { created, noContent, paginated, asyncHandler,
        badRequest, notFound, conflict } = require('../../utils/http');

// 201 Created（+ 可选 Location）
exports.create = asyncHandler(async (req, res) => {
  const item = svc.create(req.user.id, req.body);
  return created(res, item, `/api/collections/${item.id}`);
});

// 204 No Content（删除，无 body）
exports.remove = asyncHandler(async (req, res) => {
  svc.remove(req.user.id, req.params.id);
  return noContent(res);
});

// 列表分页：{ items, total, hasMore }
exports.list = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows, total } = svc.list(req.user.id, { limit, offset }); // total 来自 COUNT(*)
  return res.json(paginated(rows, { total, limit, offset }));
});
```

`paginated(items, { total, limit, offset })` 行为：

- `total` 已知 → 原样回传，`hasMore = offset + 本页条数 < total`。
- `total` 未知 → `total` 兜底为 `offset + 本页条数`；`hasMore` 按「是否拿满一页」（`本页条数 >= limit`）启发式判定；无 `limit` 时保守 `false`。
- `items` 非数组归一为 `[]`，负 `offset` 归零。

---

## 6. 迁移策略

- **不 retrofit 存量端点**——避免破坏在线前端。新接口直接遵循本规范。
- 存量接口若确需现代化（如收藏收敛到 `/collections`），作为**独立带版本/灰度的改造**单独评估，不在常规迭代里顺手改。
- 新接口评审清单：状态码（201/204/409 用对了吗）、列表是否走 `paginated`、错误是否 throw `ApiError` 并带合适 `error_code`、路由顺序是否正确。
