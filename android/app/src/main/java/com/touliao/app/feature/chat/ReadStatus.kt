package com.touliao.app.feature.chat

import com.touliao.app.data.model.GroupMember
import com.touliao.app.data.model.Message

/**
 * 消息已读状态详情（F4b，对齐 Web utils/readStatus.js 语义）：
 * 消费同一后端响应形状 GET read-states → { readStates: { msgId: [userId,...] } }。
 */

/** 可查看已读详情的消息类型（与 Web READ_DETAIL_TYPES 一致，四端口径统一） */
private val READ_DETAIL_TYPES = setOf("text", "image", "file")

/** 自己发送、非删除、非发送中、服务端已落库的消息才可查看已读详情 */
fun canViewReadStatus(message: Message, currentUserId: String): Boolean {
    if (message.deleted != 0) return false
    if (message.localStatus != null) return false
    if (message.id.isBlank()) return false
    return message.sender_id == currentUserId && message.type in READ_DETAIL_TYPES
}

data class ReadStatusReader(
    val id: String,
    val name: String,
    val avatar: String,
)

data class ReadStatusModel(
    val isGroup: Boolean,
    /** 私聊：对方是否已读 */
    val peerRead: Boolean = false,
    /** 私聊：对方昵称（会话标题） */
    val peerName: String = "",
    /** 群聊：已读人数 / 应读人数（不含发送者） */
    val readCount: Int = 0,
    val recipientCount: Int = 0,
    val readers: List<ReadStatusReader> = emptyList(),
)

/**
 * 构建弹窗展示模型。
 * @param members 群成员全量列表（含我也无妨，内部会排除发送者）；私聊传空
 * @param peerId 私聊对方用户 id（拿不到时传空，退化为「有任何人已读」判定）
 */
fun buildReadStatusModel(
    isGroup: Boolean,
    members: List<GroupMember>,
    currentUserId: String,
    senderId: String,
    readUserIds: List<String>,
    peerId: String = "",
    peerName: String = "",
): ReadStatusModel {
    val readIds = readUserIds.map(String::trim).filter { it.isNotEmpty() }.distinct()
    if (!isGroup) {
        val read = if (peerId.isNotEmpty()) readIds.contains(peerId) else readIds.isNotEmpty()
        return ReadStatusModel(isGroup = false, peerRead = read, peerName = peerName)
    }
    val byId = members.associateBy { it.id }
    val recipients = members.filter { it.id.isNotEmpty() && it.id != senderId }
    val readers = readIds
        .filter { it != senderId }
        .map { id ->
            val member = byId[id]
            ReadStatusReader(
                id = id,
                name = member?.displayName?.ifBlank { member.username }.orEmpty(),
                avatar = member?.avatar.orEmpty(),
            )
        }
    return ReadStatusModel(
        isGroup = true,
        readCount = readers.size,
        recipientCount = recipients.size,
        readers = readers,
    )
}
