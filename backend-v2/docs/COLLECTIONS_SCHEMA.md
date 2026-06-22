# 收藏 `collections` 数据契约（CO4）

**状态**: 参考文档（描述现状 + 约定 `extra` 字段 schema）
**来源**: `API_REVIEW_20260622.md` §4.2 CO4
**目的**: 同一张 `collections` 表被多条写入路径共用，`extra` 此前是「客户端任意对象」，前端渲染要分情况猜字段。这里固定各 `type` 的 `extra` schema，作为前后端共同契约。

---

## 1. 表与写入路径

`collections` 表字段：`id, user_id, type, content, extra(JSON 文本), dedup_key, created_at`。

| 写入路径 | 接口 | type 来源 | extra 写入 |
|----------|------|-----------|-----------|
| `users.service.addCollection` | `POST /users/me/collections` | 客户端传入，限 `text/image/file/video` | 客户端传入对象（按下表规范化） |
| `messages.service.collect` | `POST /messages/:msgId/collect` | 被收藏消息的 `msg.type` | `{ file_url, source_msg_id }` |

> ⚠ 表情收藏（`POST /stickers/collect`）写入的是**独立的 `user_stickers` 表**，不进 `collections`，不适用本文档。

去重：两条路径都用 `utils/collections.js#collectionDedupKey(type, content, extra)` 计算 `dedup_key`，同一 `user_id + dedup_key` 视为重复 → `409 COLLECTION_DUPLICATE`。
- 非 `text` 且 `extra.file_url`/`extra.url` 存在时，以该 URL 作为身份；
- 否则以 `content` 文本哈希作为身份。

---

## 2. `type` → `content` / `extra` schema

`content` 为主体文本/标题；`extra` 为该类型的结构化补充。所有 `extra` 字段均**可选**，未知字段前端应忽略（向前兼容）。

### `text`
纯文本收藏。
- `content`: 文本内容（≤ 2000 字符，超出截断）。
- `extra`: `{}`（一般为空）。

### `image`
- `content`: 可为空或图片描述。
- `extra`:
  - `file_url` *(string)* — 图片 URL（`/uploads/...` 或云存储绝对 URL）。**去重身份字段**。
  - `width` *(number, 可选)*、`height` *(number, 可选)*。

### `file`
- `content`: 文件名或描述。
- `extra`:
  - `file_url` *(string)* — 文件 URL。**去重身份字段**。
  - `file_name` *(string, 可选)*、`file_size` *(number, 可选, 字节)*、`mime` *(string, 可选)*。

### `video`
- `content`: 可为空或描述。
- `extra`:
  - `file_url` *(string)* — 视频 URL。**去重身份字段**。
  - `thumb` *(string, 可选)* — 封面图 URL。
  - `duration` *(number, 可选, 秒)*。

---

## 3. 来自「收藏消息」的 extra（`messages.collect`）

`POST /messages/:msgId/collect` 固定写入：

```jsonc
{
  "file_url": "<被收藏消息的 file_url，文本消息为 null>",
  "source_msg_id": "<来源消息 id，便于回跳原对话>"
}
```

- `type` 取被收藏消息的 `msg.type`（`text` / `image` / `file` / `video` / ...）。
- 前端可凭 `source_msg_id` 提供「定位到原消息」能力。

---

## 4. 响应形态

读取/写入收藏时，`extra` 一律以**已解析的对象**回传（服务层 `JSON.parse`），前端无需再解析：

```jsonc
// GET /users/me/collections（存量：裸数组，向后兼容）
// POST 收藏（CO3：回传新建对象，保留 success 兼容）
{ "success": true, "id": "...", "type": "image", "content": "", "extra": { "file_url": "/uploads/x.png" }, "created_at": 1750000000 }
```

> 新增收藏类接口若要列表分页，按 `API_GUIDELINES.md` 走 `{ items, total, hasMore }`；存量 `GET /users/me/collections` 维持裸数组不变。
