package com.vxin.app.core.storage

import android.content.Context
import com.vxin.app.data.model.Message
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 离线消息历史缓存（Android · SharedPreferences + kotlinx.serialization）。
 * 契约见 docs/offline-message-cache-contract.md，语义 1:1 对齐 Web 参考实现
 * web/src/utils/msgCache.js（同款 normalize / mergeById / load / save / remove / clear）。
 *
 * 定位：**首屏占位缓存，非真相源**。服务端永远是真相源；本缓存出错最坏退化为
 * 「空白等拉取」，绝不产生数据错误。任何 IO 异常一律静默降级，不影响主流程。
 *
 * 只存「已被服务端确认的历史消息」(有真实 id)；未确认/失败的待发消息由 [OutboxStore] 负责。
 * 载体沿用 OutboxStore 的成熟形态（prefs + Json），schema 版本号进键名，破坏性变更时整体弃用。
 *
 * 隐私红线（各自有测试）：
 *  - 阅后即焚会话（burnAfter>0）**绝不落盘**——由 ChatViewModel 跳过 save（后端 burn 为会话级）。
 *  - 退出登录 / 切换账号 → clear() 全清（由 SessionManager 触发）。
 */
@Singleton
class MsgCacheStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    // 键名带 schema 版本前缀；破坏性变更时改 KEY_PREFIX 弃用旧键。
    private val prefs = context.getSharedPreferences("vxin_msgcache_v1", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val listSerializer = ListSerializer(Message.serializer())

    /** 读取会话缓存（最近 50，created_at 升序）。任何异常 → 返回空。 */
    fun load(conversationId: String): List<Message> {
        if (conversationId.isBlank()) return emptyList()
        val raw = prefs.getString(conversationId, null) ?: return emptyList()
        return runCatching { json.decodeFromString(listSerializer, raw) }.getOrDefault(emptyList())
    }

    /** 覆写会话缓存（内部 normalize：去乐观/焚毁、按 id 去重、升序、截断最近 50）。异常静默。 */
    fun save(conversationId: String, msgs: List<Message>) {
        if (conversationId.isBlank()) return
        val clean = normalize(msgs)
        runCatching {
            prefs.edit().apply {
                // 空数组等价删除该会话键（与 Web saveCache 一致）。
                if (clean.isEmpty()) remove(conversationId)
                else putString(conversationId, json.encodeToString(listSerializer, clean))
            }.apply()
        }
    }

    /** 删除单条（撤回/删除）。 */
    fun remove(conversationId: String, msgId: String) {
        if (conversationId.isBlank()) return
        val cur = load(conversationId)
        val next = cur.filterNot { it.id == msgId }
        if (next.size != cur.size) save(conversationId, next)
    }

    /** 清理：有 convId=清该会话；无参=清全部（登出/切账号，隐私红线）。 */
    fun clear(conversationId: String? = null) {
        runCatching {
            prefs.edit().apply {
                if (conversationId != null) remove(conversationId) else clear()
            }.apply()
        }
    }

    companion object {
        const val MAX_PER_CONV = 50   // 每会话最近 50 条（与 outbox / 契约一致）

        /**
         * 归一化：只留有真实 id 的消息，按 created_at 升序 + id tie-break，截断最近 50。
         * 对齐 msgCache.js `normalize`。
         *  - 无真实 id / 乐观消息(clientMsgId 或 localStatus 非空) 不入缓存；
         *  - 同 id 只留一条（后出现者覆盖，配合 mergeById 让 server 版本生效）。
         *
         * 关于「阅后即焚不落盘」：后端 burn-after 为**会话级**设置
         * (conversation_settings.burn_after)，消息 DTO 无独立 burn 字段。故隐私红线在
         * 调用方（ChatViewModel）落实——burnAfter>0 的会话直接跳过 save。此处按 Web
         * 契约保留「乐观/无 id 消息不落盘」的最小防线。
         */
        fun normalize(msgs: List<Message>): List<Message> {
            val map = LinkedHashMap<String, Message>()
            for (m in msgs) {
                if (m.id.isBlank()) continue
                if (m.clientMsgId != null || m.localStatus != null) continue  // 乐观/待发不入缓存
                map[m.id] = m                                                 // 后者覆盖同 id
            }
            return map.values
                .sortedWith(compareBy({ it.created_at }, { it.id }))
                .takeLast(MAX_PER_CONV)
        }

        /**
         * dedupById：server 版本覆盖 cache 版本（解决「缓存旧、服务端已编辑」）。
         * 对齐 msgCache.js `mergeById`。
         */
        fun mergeById(cached: List<Message>, server: List<Message>): List<Message> {
            val map = LinkedHashMap<String, Message>()
            for (m in cached) if (m.id.isNotBlank() && m.clientMsgId == null) map[m.id] = m
            for (m in server) if (m.id.isNotBlank() && m.clientMsgId == null) map[m.id] = m  // server 覆盖
            return normalize(map.values.toList())
        }
    }
}
