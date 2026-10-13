package com.touliao.app.feature.chat

import com.touliao.app.data.model.Conversation

/**
 * 会话列表的本地状态计算（纯函数，便于 JVM 单测）。
 * 列表顺序以服务端为准：`ORDER BY pinned DESC, 最后消息时间 DESC`（conversations.service.js listConversations），
 * 客户端在整表刷新之间做的乐观重排必须复现同一规则。
 */

/**
 * 新消息到达后把 [updated]（已更新最后消息/时间/未读的同 id 会话）放回列表：
 * - 归档会话原位更新，不移动（主列表/归档列表按 archived 标记分流，对齐 Web）；
 * - 置顶会话移到最前（它是置顶组里最新的一条）；
 * - 非置顶会话插到第一个非置顶会话的位置，即排在所有置顶会话之后、其余会话之前，
 *   不会再跑到置顶会话前面（LIST-2）。
 * 列表里找不到该会话时原样返回。
 */
internal fun reorderAfterIncoming(list: List<Conversation>, updated: Conversation): List<Conversation> {
    val idx = list.indexOfFirst { it.id == updated.id }
    if (idx < 0) return list
    val rest = list.toMutableList()
    rest.removeAt(idx)
    val insertAt = when {
        updated.archived == 1 -> idx
        updated.pinned == 1 -> 0
        else -> rest.indexOfFirst { it.pinned != 1 }.let { if (it < 0) rest.size else it }
    }
    rest.add(insertAt, updated)
    return rest
}

/**
 * 会话被双向清空（本端操作成功，或收到 conversation_messages_cleared 事件）后的列表：
 * 去掉该会话的最后一条预览；记录已全部删除，未读数和「有人@我」也一并清零（与服务端重算口径一致）。
 * 时间和位置不动，等下次整表刷新由服务端决定。
 */
internal fun clearConversationPreview(list: List<Conversation>, convId: String): List<Conversation> =
    list.map {
        if (it.id == convId) {
            it.copy(lastMessage = null, lastMessageType = null, lastSenderName = null, unreadCount = 0, hasMention = false)
        } else it
    }

/**
 * 长按菜单「清空」项的文案；返回 null 表示不显示该项。
 * 该接口是双向清空（私聊连对方的记录一起删）。群聊只有群主/管理员有权限，
 * 而列表项不带当前用户的群角色，无法判断，所以群聊不显示（群聊清空走群资料页）。
 */
internal fun clearMenuLabel(type: String): String? = when (type) {
    "group" -> null
    "filehelper" -> "清空聊天记录"   // 文件传输助手只有自己，不存在「对方」
    else -> "双向清空聊天记录"
}

/** 清空确认框正文：私聊照搬 Web privateChat.confirmClearTemplate，明确告知对方也看不到 */
internal fun clearConfirmText(conv: Conversation): String {
    val name = conv.name.ifBlank { "当前聊天" }
    return if (conv.type == "filehelper") {
        "确认清空「$name」的全部聊天记录？此操作不可恢复。"
    } else {
        "确认双向删除「$name」的全部聊天记录？对方也将看不到这些记录。"
    }
}
