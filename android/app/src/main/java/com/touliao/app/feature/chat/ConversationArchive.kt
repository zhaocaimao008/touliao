package com.touliao.app.feature.chat

import com.touliao.app.data.model.Conversation

/**
 * 会话归档本地分流（F4b，对齐 Web utils/archiveConversations.js 语义）：
 * 列表一次性拉全量（includeArchived=1），UI 按 archived 标记本地分主列表/归档列表。
 * 新消息 socket 更新只改该会话的 summary/unread、保留 archived 标记，
 * 归档会话永远不会因新消息被移回主列表（分流始终以标记为准）。
 */

/** 主列表会话（未归档） */
fun activeConversations(conversations: List<Conversation>): List<Conversation> =
    conversations.filter { it.archived == 0 }

/** 归档列表会话 */
fun archivedConversations(conversations: List<Conversation>): List<Conversation> =
    conversations.filter { it.archived == 1 }

/** 归档会话聚合未读数（归档入口行角标，>99 由 UI 显示 99+） */
fun archiveUnreadTotal(conversations: List<Conversation>): Int =
    archivedConversations(conversations).sumOf { maxOf(0, it.unreadCount) }
