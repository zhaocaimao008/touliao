package com.vxin.app.core.storage

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 安全持久化 Bearer token。
 * 使用 Jetpack Security 的 EncryptedSharedPreferences（AES256），
 * 对应 Web 端 localStorage 的 vxin_electron_token，但加密落盘。
 */
@Singleton
class TokenStore @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val prefs: SharedPreferences = runCatching {
        createEncrypted(context)
    }.getOrElse {
        // 极少数情况下 keyset 损坏：清掉重建，避免崩溃
        context.deleteSharedPreferences(FILE_NAME)
        createEncrypted(context)
    }

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value)
        }.apply()

    val isLoggedIn: Boolean get() = !token.isNullOrBlank()

    fun clear() = prefs.edit().clear().apply()

    private fun createEncrypted(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context,
            FILE_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private companion object {
        const val FILE_NAME = "vxin_secure_prefs"
        const val KEY_TOKEN = "vxin_token"
    }
}
