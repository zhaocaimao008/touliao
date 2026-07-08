package com.vxin.app.core.storage

import android.content.Context
import com.vxin.app.data.model.LocalMsgStatus
import com.vxin.app.data.model.Message
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 失败消息「待发件箱」——让发送失败的文本消息在切走会话 / 杀进程重启后依然不丢失，
 * 对齐 Web 的 outbox 体验（顶级 IM 标配：你发出去没成功的消息永远还在，直到成功或删除）。
 *
 * 按 conversationId 持久化到 SharedPreferences；每会话最多留 50 条防膨胀。
 * 只存纯文本（type=="text"）——媒体含上传态与本地 URI，不适合塞进 prefs。
 */
@Singleton
class OutboxStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("vxin_outbox", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true }
    private val listSerializer = ListSerializer(Message.serializer())

    /** 读取某会话的待发件箱（失败态文本消息，可能为空） */
    fun load(conversationId: String): List<Message> {
        if (conversationId.isBlank()) return emptyList()
        val raw = prefs.getString(conversationId, null) ?: return emptyList()
        return runCatching { json.decodeFromString(listSerializer, raw) }
            .getOrDefault(emptyList())
            // @Transient 不参与序列化，反序列化回来 localStatus 为 null → 恢复为 failed
            .map { it.copy(localStatus = LocalMsgStatus.FAILED, clientMsgId = it.id) }
    }

    /** 新增/更新一条失败消息（按 id 去重；仅文本） */
    fun upsert(conversationId: String, msg: Message) {
        if (conversationId.isBlank() || msg.type != "text") return
        val list = loadRaw(conversationId).toMutableList()
        val idx = list.indexOfFirst { it.id == msg.id }
        // 落盘的是「干净」形态：localStatus/clientMsgId 是 @Transient 不会被写入，
        // 但 id 会保留作为幂等键与去重键。
        if (idx >= 0) list[idx] = msg else list.add(msg)
        save(conversationId, list.takeLast(MAX_PER_CONV))
    }

    /** 消息成功送达后移除（按 id） */
    fun remove(conversationId: String, msgId: String) {
        if (conversationId.isBlank()) return
        val list = loadRaw(conversationId)
        val next = list.filterNot { it.id == msgId }
        if (next.size != list.size) save(conversationId, next)
    }

    private fun loadRaw(conversationId: String): List<Message> {
        val raw = prefs.getString(conversationId, null) ?: return emptyList()
        return runCatching { json.decodeFromString(listSerializer, raw) }.getOrDefault(emptyList())
    }

    private fun save(conversationId: String, list: List<Message>) {
        prefs.edit().apply {
            if (list.isEmpty()) remove(conversationId)
            else putString(conversationId, json.encodeToString(listSerializer, list))
        }.apply()
    }

    private companion object {
        const val MAX_PER_CONV = 50
    }
}
