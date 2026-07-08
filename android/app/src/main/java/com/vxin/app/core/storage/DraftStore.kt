package com.vxin.app.core.storage

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 会话输入草稿（对齐微信/Web：切走会话再回来，未发送的文字仍在；会话列表显示「[草稿]」前缀）。
 * 按 conversationId 持久化到 SharedPreferences，进程重启后仍保留。
 */
@Singleton
class DraftStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs = context.getSharedPreferences("vxin_drafts", Context.MODE_PRIVATE)

    /** 读取草稿；无则返回空串 */
    fun get(conversationId: String): String =
        if (conversationId.isBlank()) "" else prefs.getString(conversationId, "").orEmpty()

    /** 写入草稿：空则清除（避免残留空键） */
    fun set(conversationId: String, text: String) {
        if (conversationId.isBlank()) return
        prefs.edit().apply {
            if (text.isBlank()) remove(conversationId) else putString(conversationId, text)
        }.apply()
    }

    fun clear(conversationId: String) = set(conversationId, "")
}
