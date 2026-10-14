package com.touliao.app.feature.chat

/**
 * 消息气泡单击分发（BUBBLE-1）。
 *
 * 整条气泡只保留外层一个 combinedClickable（单击 + 长按菜单），内容层不再各自挂铺满气泡的 clickable：
 * Compose 先把触摸交给子节点，子节点 clickable 一按下就消费事件，外层等不到长按，
 * 图片/语音/文件/视频/名片/聊天记录气泡此前长按都弹不出菜单（无法撤回、转发、保存图片、引用回复）。
 * 单击改在外层按消息类型分发，各类型的单击行为与原先内层 clickable 完全一致。
 *
 * 纯 Kotlin、无 Android 依赖，JVM 单测直跑。
 */
internal enum class BubbleTap(
    /** 读屏朗读的单击动作名（combinedClickable 的 onClickLabel） */
    val label: String,
) {
    IMAGE("查看大图"),
    VOICE("播放语音"),
    FILE("打开文件"),
    VIDEO("播放视频"),
    MERGED("查看聊天记录"),
}

/**
 * 消息类型 → 单击动作。null = 单击无动作：
 * 文本（原本外层 onClick 就是空的）、名片（原本 MediaCard 的 onClick 就是空的）及其它类型，保持原行为。
 */
internal fun bubbleTapOf(type: String): BubbleTap? = when (type) {
    "image" -> BubbleTap.IMAGE
    "voice" -> BubbleTap.VOICE
    "file" -> BubbleTap.FILE
    "video" -> BubbleTap.VIDEO
    "merged" -> BubbleTap.MERGED
    else -> null
}

/** 长按的读屏动作名：TalkBack「双击并按住」即可打开消息菜单（combinedClickable 的 onLongClickLabel） */
internal const val BUBBLE_LONG_CLICK_LABEL = "打开消息菜单"
