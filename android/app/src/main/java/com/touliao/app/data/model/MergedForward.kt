package com.touliao.app.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * 合并转发（F4a #2）—— Message.type == "merged" 时 content 为本文件序列化的 JSON，
 * 服务端透传不解析（见 messages.service ALLOWED_HTTP_TYPES）。纯 Kotlin、无 Android
 * 依赖，JVM 单测直跑；语义对齐 Web utils/mergedForward.js。
 */

/** 单条被合并消息的摘要（mid/type/sender 名/片段/时间，不含消息全文） */
@Serializable
data class MergedForwardItem(
    val mid: String = "",
    val type: String = "text",
    val sender: String = "",
    val senderName: String = "",
    val snippet: String = "",
    val ts: Long = 0,
)

/** merged 消息 content 的结构 */
@Serializable
data class MergedForwardContent(
    val title: String = "",
    val items: List<MergedForwardItem> = emptyList(),
)

/** 可参与合并转发的消息类型（红包/转账/系统消息等被过滤） */
private val FORWARDABLE_TYPES = setOf("text", "image", "voice", "video", "file", "contact_card", "merged")

/** 合并转发条数上限（对齐 Web：buildMergedPayload slice(0, 30)） */
const val MERGED_FORWARD_MAX_ITEMS = 30

fun isForwardableMessage(msg: Message): Boolean =
    msg.deleted == 0 && msg.type in FORWARDABLE_TYPES

private val mergedJson = Json { ignoreUnknownKeys = true }

fun parseMergedContent(content: String): MergedForwardContent =
    runCatching { mergedJson.decodeFromString<MergedForwardContent>(content) }.getOrNull()
        ?: MergedForwardContent()

/** 各类型在合并卡片/详情里的摘要文案（对齐 Web messageSnippet 的中文标签） */
fun mergedSnippetOf(msg: Message): String {
    val label = { t: String ->
        when (t) {
            "image" -> "[图片]"; "voice" -> "[语音]"; "video" -> "[视频]"; "file" -> "[文件]"
            "contact_card", "contact" -> "[名片]"; "merged" -> "[聊天记录]"
            else -> "[$t]"
        }
    }
    return when (msg.type) {
        "text" -> msg.content.take(80)
        "voice" -> label("voice") + if (msg.duration > 0) " ${msg.duration}″" else ""
        "contact_card", "contact" -> label("contact_card") + " " + parseContactName(msg.content)
        "merged" -> label("merged") + " " + parseMergedContent(msg.content).title
        else -> label(msg.type) + " " + msg.content.trim()
    }.trim()
}

private fun parseContactName(content: String): String =
    runCatching { mergedJson.decodeFromString<ContactCardContent>(content) }.getOrNull()
        ?.username.orEmpty()

/**
 * 组装 merged content：过滤不可转发类型、按传入顺序（即时间序）截前 30 条。
 * title 由调用方给（如「XX的聊天记录」「N条聊天记录」）。
 */
fun buildMergedPayload(messages: List<Message>, title: String): MergedForwardContent {
    val items = messages.filter(::isForwardableMessage).take(MERGED_FORWARD_MAX_ITEMS).map { m ->
        MergedForwardItem(
            mid = m.id,
            type = m.type,
            sender = m.sender_id,
            senderName = m.senderName,
            snippet = mergedSnippetOf(m),
            ts = m.created_at,
        )
    }
    return MergedForwardContent(title = title.ifBlank { items.size.toString() }, items = items)
}

fun MergedForwardContent.encodeToJson(): String = mergedJson.encodeToString(MergedForwardContent.serializer(), this)
