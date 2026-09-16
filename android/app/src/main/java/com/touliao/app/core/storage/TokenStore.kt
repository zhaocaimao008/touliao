package com.touliao.app.core.storage

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
class TokenStore internal constructor(private val prefs: SharedPreferences) {
    @Inject constructor(@ApplicationContext context: Context) : this(createPrefs(context))

    private companion object {
        const val FILE_NAME = "vxin_secure_prefs"
        const val KEY_TOKEN = "vxin_token"
        fun createPrefs(context: Context): SharedPreferences = runCatching {
            createEncrypted(context)
        }.getOrElse {
            // 极少数情况下 keyset 损坏：清掉重建，避免崩溃
            context.deleteSharedPreferences(FILE_NAME)
            createEncrypted(context)
        }
        fun createEncrypted(context: Context): SharedPreferences {
            val masterKey = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
            return EncryptedSharedPreferences.create(context, FILE_NAME, masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
        }
    }

    data class Snapshot(val token: String?, val revision: Long, val identityEpoch: Long)
    private var revision = 0L
    var identityEpoch = 0L
        private set
    @Synchronized fun beginIdentityChange() { identityEpoch++ }
    @Synchronized fun snapshot() = Snapshot(token, revision, identityEpoch)
    @Synchronized fun isCurrent(snapshot: Snapshot) = snapshot == snapshot()
    @Synchronized fun withCurrent(snapshot: Snapshot, action: () -> Unit): Boolean {
        if (!isCurrent(snapshot)) return false
        action()
        return true
    }
    @Synchronized fun invalidate(snapshot: Snapshot): Snapshot? {
        if (snapshot.token == null || !isCurrent(snapshot)) return null
        clear()
        return snapshot()
    }
    @Synchronized fun installReplacement(expected: Snapshot, value: String, onInstalled: () -> Unit): Boolean {
        if (value.isBlank() || !isCurrent(expected)) return false
        token = value
        onInstalled()
        return true
    }
    var token: String?
        get() = synchronized(this) { prefs.getString(KEY_TOKEN, null) }
        set(value) = synchronized(this) {
            revision++
            prefs.edit().apply {
                if (value == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, value)
            }.apply()
        }

    val isLoggedIn: Boolean get() = !token.isNullOrBlank()

    fun clear() { token = null }

}
