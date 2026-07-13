package com.vxin.app.core.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.vxin.app.data.model.Account
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
class AccountStore @Inject constructor(
    @ApplicationContext context: Context,
    private val json: Json,
) {
    private val prefs: SharedPreferences = runCatching { create(context) }.getOrElse {
        context.deleteSharedPreferences(FILE); create(context)
    }

    fun accounts(): List<Account> = runCatching {
        prefs.getString(KEY_LIST, null)?.let { json.decodeFromString<List<Account>>(it) } ?: emptyList()
    }.getOrDefault(emptyList())

    fun activeId(): String? = prefs.getString(KEY_ACTIVE, null)

    /** 登录成功：加入/更新该账号并设为当前 */
    fun upsertActive(account: Account) {
        val next = accounts().filterNot { it.id == account.id } + account
        save(next)
        prefs.edit().putString(KEY_ACTIVE, account.id).apply()
    }

    fun tokenFor(id: String): String? = accounts().firstOrNull { it.id == id }?.token

    /** 更新指定账号已存的 token（如改密后旧 token 失效、拿到新 token）。 */
    fun updateToken(id: String, token: String) {
        val next = accounts().map { if (it.id == id) it.copy(token = token) else it }
        save(next)
    }

    fun setActive(id: String) { prefs.edit().putString(KEY_ACTIVE, id).apply() }

    /** 移除账号，返回剩余账号 */
    fun remove(id: String): List<Account> {
        val next = accounts().filterNot { it.id == id }
        save(next)
        if (activeId() == id) prefs.edit().remove(KEY_ACTIVE).apply()
        return next
    }

    private fun save(list: List<Account>) {
        prefs.edit().putString(KEY_LIST, json.encodeToString(list)).apply()
    }

    private fun create(ctx: Context): SharedPreferences {
        val key = MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        return EncryptedSharedPreferences.create(
            ctx, FILE, key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private companion object {
        const val FILE = "vxin_accounts"
        const val KEY_LIST = "accounts"
        const val KEY_ACTIVE = "active_id"
    }
}
