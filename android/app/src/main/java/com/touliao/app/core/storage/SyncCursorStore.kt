package com.touliao.app.core.storage

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** 每台设备、每个账号、每个会话独立维护的已提交同步游标。 */
@Singleton
class SyncCursorStore @Inject constructor(@ApplicationContext context: Context) {
    private val prefs = context.getSharedPreferences("touliao_sync_cursors_v1", Context.MODE_PRIVATE)
    private fun key(accountId: String, conversationId: String) = "$accountId:$conversationId"
    fun load(accountId: String, conversationId: String): Long =
        prefs.getLong(key(accountId, conversationId), 0L).coerceAtLeast(0L)
    fun save(accountId: String, conversationId: String, sequence: Long) {
        val key = key(accountId, conversationId)
        if (sequence > prefs.getLong(key, 0L)) prefs.edit().putLong(key, sequence).apply()
    }
}
