package com.touliao.app.feature.search

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonObject

/**
 * 全局搜索分类筛选（F4b，对齐 Web utils/messageSearchFilters.js：
 * type 取值/时间区间语义/摘要规则与 Web 完全一致，四端口径统一）。
 */

/** 类型筛选选项（value 空串 = 全部；映射后端 messages.type） */
data class SearchTypeOption(val value: String, val label: String, val icon: String)

val MESSAGE_SEARCH_TYPES: List<SearchTypeOption> = listOf(
    SearchTypeOption("", "全部", "○"),
    SearchTypeOption("text", "文本", "文"),
    SearchTypeOption("image", "图片", "▧"),
    SearchTypeOption("voice", "语音", "◖"),
    SearchTypeOption("video", "视频", "▶"),
    SearchTypeOption("file", "文件", "▤"),
    SearchTypeOption("contact_card", "名片", "人"),
    SearchTypeOption("red_packet", "红包", "包"),
    SearchTypeOption("transfer", "转账", "¥"),
    SearchTypeOption("merged", "合并转发", "☷"),
    SearchTypeOption("call", "通话", "☎"),
)

/** 时间筛选：空串=不限 | today=今天 | 7d=近7天 | 30d=近30天（秒级 from/to） */
data class SearchTimeRangeOption(val value: String, val label: String)

val MESSAGE_SEARCH_TIME_RANGES: List<SearchTimeRangeOption> = listOf(
    SearchTimeRangeOption("", "不限"),
    SearchTimeRangeOption("today", "今天"),
    SearchTimeRangeOption("7d", "7天"),
    SearchTimeRangeOption("30d", "30天"),
)

/** 搜索请求参数（不含 q/limit；null 字段不随请求发送） */
data class SearchFilterParams(
    val type: String? = null,
    val fromSec: Long? = null,
    val toSec: Long? = null,
    val senderId: String? = null,
) {
    val isEmpty: Boolean get() = type == null && fromSec == null && toSec == null && senderId == null
}

private fun startOfDay(epochMillis: Long): Long {
    val cal = java.util.Calendar.getInstance().apply { timeInMillis = epochMillis }
    cal.set(java.util.Calendar.HOUR_OF_DAY, 0)
    cal.set(java.util.Calendar.MINUTE, 0)
    cal.set(java.util.Calendar.SECOND, 0)
    cal.set(java.util.Calendar.MILLISECOND, 0)
    return cal.timeInMillis
}

/**
 * 由筛选状态构造请求参数。
 * today → 今天 0 点起；7d/30d → 从当天 0 点再往前推 N 天（与 Web buildMessageSearchParams 同口径）。
 * @param nowMillis 当前时间（毫秒），测试注入固定值
 */
fun buildSearchFilterParams(
    type: String,
    timeRange: String,
    senderId: String,
    nowMillis: Long = System.currentTimeMillis(),
): SearchFilterParams {
    if (type.isBlank() && timeRange.isBlank() && senderId.isBlank()) return SearchFilterParams()
    var params = SearchFilterParams(
        type = type.takeIf { it.isNotBlank() },
        senderId = senderId.takeIf { it.isNotBlank() },
    )
    if (timeRange.isNotBlank()) {
        var start = startOfDay(nowMillis)
        if (timeRange == "7d") start -= 7L * 24 * 3600 * 1000
        if (timeRange == "30d") start -= 30L * 24 * 3600 * 1000
        params = params.copy(fromSec = start / 1000, toSec = nowMillis / 1000)
    }
    return params
}

private fun searchTypeIconOf(type: String): String =
    MESSAGE_SEARCH_TYPES.firstOrNull { it.value == type }?.icon ?: "•"

/** 结果行类型图标 */
fun messageSearchTypeIcon(type: String): String = searchTypeIconOf(type)

private fun searchTypeLabel(type: String): String =
    MESSAGE_SEARCH_TYPES.firstOrNull { it.value == type }?.label ?: type

private val summaryJson = Json { ignoreUnknownKeys = true }

/** 解析结构化消息 content（名片/红包/转账/合并转发 的 JSON 字段），坏 JSON 返回空对象 */
private fun parseContentObject(content: String): JsonObject =
    runCatching { summaryJson.parseToJsonElement(content).jsonObject }.getOrNull() as? JsonObject ?: JsonObject(emptyMap())

private fun JsonObject.stringOf(key: String): String =
    runCatching { get(key)?.jsonPrimitive?.content }.getOrNull().orEmpty()

private fun compact(label: String, detail: String = ""): String {
    val safe = detail.trim()
    return if (safe.isNotEmpty()) "[$label] $safe" else "[$label]"
}

/**
 * 结果摘要（对齐 Web formatSearchMessageSummary）：
 * 结构化消息只透出人话字段（名片备注/红包祝福/转账备注/合并标题），不泄原始 JSON。
 */
fun formatSearchMessageSummary(type: String, content: String): String {
    val body = content.trim()
    return when (type) {
        "text" -> body
        "image" -> compact("图片", body)
        "voice" -> compact("语音")
        "video" -> compact("视频", body)
        "file" -> compact("文件", body)
        "contact_card" -> {
            val obj = parseContentObject(body)
            compact("名片", obj.stringOf("remark").ifBlank { obj.stringOf("username") }.ifBlank { obj.stringOf("name") })
        }
        "red_packet" -> compact("红包", parseContentObject(body).stringOf("greeting"))
        "transfer" -> compact("转账", parseContentObject(body).stringOf("note"))
        "merged" -> compact("聊天记录", parseContentObject(body).stringOf("title"))
        "call" -> compact("通话", body)
        else -> body.ifBlank { compact(searchTypeLabel(type)) }
    }
}
