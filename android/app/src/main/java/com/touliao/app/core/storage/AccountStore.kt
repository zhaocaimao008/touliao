package com.touliao.app.core.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.touliao.app.data.model.Account
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 多账号本地存储(含 token，加密)。支持秒切换:每个账号自带 token，
 * 切换即换 active token。token 仍只加密落盘，不进网络以外的明文。
 */
@Singleton
class AccountStore internal constructor(
    private val prefs: SharedPreferences,
    private val json: Json,
    private val tokens: TokenStore,
) {
    @Inject constructor(@ApplicationContext context: Context, json: Json, tokens: TokenStore) :
        this(createPrefs(context), json, tokens)

    // Legacy unscoped accounts cannot be assigned to a trustworthy server.
    private val listKey get() = "$KEY_LIST:${tokens.origin}"
    private val activeKey get() = "$KEY_ACTIVE:${tokens.origin}"

    fun accounts(): List<Account> = synchronized(tokens) { runCatching {
        prefs.getString(listKey, null)?.let { json.decodeFromString<List<Account>>(it) } ?: emptyList()
    }.getOrDefault(emptyList()) }

    fun activeId(): String? = synchronized(tokens) { prefs.getString(activeKey, null) }

    /** 登录成功：加入/更新该账号并设为当前 */
    fun upsertActive(account: Account) = synchronized(tokens) {
        val next = accounts().filterNot { it.id == account.id } + account
        save(next)
        prefs.edit().putString(activeKey, account.id).apply()
    }

    fun tokenFor(id: String): String? = accounts().firstOrNull { it.id == id }?.token

    /** 更新指定账号已存的 token（如改密后旧 token 失效、拿到新 token）。 */
    fun updateToken(id: String, token: String) = synchronized(tokens) {
        val next = accounts().map { if (it.id == id) it.copy(token = token) else it }
        save(next)
    }

    fun setActive(id: String) = synchronized(tokens) { prefs.edit().putString(activeKey, id).apply() }

    /** 移除账号，返回剩余账号 */
    fun remove(id: String): List<Account> = synchronized(tokens) {
        val next = accounts().filterNot { it.id == id }
        prefs.edit().also { edit -> prefs.all.keys.filter { it.startsWith("conversations:") && it.endsWith(":$id") }.forEach { edit.remove(it) } }.commit()
        save(next)
        if (activeId() == id) prefs.edit().remove(activeKey).apply()
        next
    }

    fun cachedConversations(origin: String): List<com.touliao.app.data.model.Conversation> {
        val id = activeId() ?: return emptyList()
        return runCatching {
            prefs.getString("conversations:$origin:$id", null)?.let {
                json.decodeFromString<List<com.touliao.app.data.model.Conversation>>(it)
            } ?: emptyList()
        }.getOrDefault(emptyList())
    }

    suspend fun cacheConversations(origin: String, id: String, list: List<com.touliao.app.data.model.Conversation>) = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        // Offline navigation metadata only: never persist message previews (including burn content).
        val safe = list.map { it.copy(lastMessage = null, lastMessageType = null, lastSenderName = null) }
        prefs.edit().putString("conversations:$origin:$id", json.encodeToString(safe)).commit()
    }

    private fun save(list: List<Account>) {
        prefs.edit().putString(listKey, json.encodeToString(list)).apply()
    }

    private companion object {
        const val FILE = "vxin_accounts"
        const val KEY_LIST = "accounts"
        const val KEY_ACTIVE = "active_id"

        fun createPrefs(context: Context): SharedPreferences = runCatching { create(context) }.getOrElse {
            context.deleteSharedPreferences(FILE); create(context)
        }

        fun create(ctx: Context): SharedPreferences {
            val key = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            return EncryptedSharedPreferences.create(
                ctx, FILE, key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }
}
